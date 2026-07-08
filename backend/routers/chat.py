"""
Chat API — POST /chat
Streams Ollama responses as SSE events per the LeapReader architecture spec.

SSE Event Types (AD-3):
  token        {type:"token",       pane_id, payload:{text}}
  meta         {type:"meta",        pane_id, payload:{context_truncated:bool, sources?:[]}}
  error        {type:"error",       pane_id, payload:{code, message}}
  tool_call    {type:"tool_call",   pane_id, payload:{tool, args}}
  pull_progress — emitted by model_manager, not this router
"""

import asyncio
import json
import uuid
from typing import AsyncGenerator

from fastapi import APIRouter, HTTPException, Request
from ollama_client import get_client
import ollama
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from context_utils import trim_to_tokens
from model_manager import DEFAULT_MODEL
from web_tools import TOOL_DEFINITIONS as INTERNET_TOOLS
from web_tools import web_search as _web_search_impl
from web_tools import fetch_url as _fetch_url_impl

router = APIRouter(prefix="/chat", tags=["chat"])

VALID_PANE_IDS = {"left", "right"}

# Active stream tasks keyed by (pane_id, session_id) → asyncio.Task
_active_streams: dict[tuple[str, str], asyncio.Task] = {}


class ChatRequest(BaseModel):
    pane_id: str  # "left" | "right"
    session_id: str
    message: str
    context_text: str = ""
    web_search: bool = False
    model: str = DEFAULT_MODEL


def _sse_event(event: dict) -> dict:
    return {"data": json.dumps(event)}


def _token_event(pane_id: str, text: str) -> dict:
    return _sse_event({"type": "token", "pane_id": pane_id, "payload": {"text": text}})


def _meta_event(pane_id: str, context_truncated: bool, sources: list | None = None) -> dict:
    payload: dict = {"context_truncated": context_truncated}
    if sources:
        payload["sources"] = sources
    return _sse_event({"type": "meta", "pane_id": pane_id, "payload": payload})


def _error_event(pane_id: str, code: str, message: str = "") -> dict:
    return _sse_event({"type": "error", "pane_id": pane_id, "payload": {"code": code, "message": message}})


async def _stream_chat(req: ChatRequest, queue: asyncio.Queue) -> None:
    """
    Run ollama.chat in an executor thread and push SSE events to queue.

    Tools (web_search + fetch_url) are ALWAYS offered to the model so it can
    autonomously decide when external information is needed.  The web_search
    flag from the frontend is now a "prefer web" hint: when True the system
    prompt instructs the model to search proactively; when False it may still
    call tools but only when it judges them necessary.
    """
    loop = asyncio.get_running_loop()

    context_text, truncated = trim_to_tokens(req.context_text)

    # Keep the system prompt concise and free of hand-written tool descriptions.
    # Ollama injects the tool schema into the model context automatically via the
    # `tools` parameter; duplicating it here confuses smaller models into
    # outputting raw JSON text instead of using structured tool_calls.
    system_parts = ["You are a helpful AI assistant built into the LeapReader PDF reader."]
    if context_text:
        system_parts.append(
            f"The user is currently reading a document. "
            f"Relevant excerpt:\n\n{context_text}"
        )
    if req.web_search:
        system_parts.append(
            "The user wants web-grounded answers. "
            "Call the web_search tool (and fetch_url for specific pages) "
            "before answering."
        )

    messages = [{"role": "system", "content": "\n\n".join(system_parts)}]
    messages.append({"role": "user", "content": req.message})

    # Emit meta before streaming (context_truncated status)
    await queue.put(_meta_event(req.pane_id, truncated))

    def _run_stream():
        sources: list[dict] = []
        local_messages = list(messages)
        # Track whether the model supports tools; disable on first ResponseError.
        active_tools: list | None = INTERNET_TOOLS

        try:
            # ReAct tool loop — runs regardless of the web_search toggle.
            # The model decides for each turn whether to call a tool or answer.
            for _ in range(8):
                try:
                    resp = get_client().chat(
                        model=req.model,
                        messages=local_messages,
                        tools=active_tools,
                        stream=False,
                    )
                except ollama.ResponseError as e:
                    if "does not support tools" in str(e).lower():
                        # Model cannot use tools — fall through to plain stream
                        active_tools = None
                        break
                    raise

                tool_calls = getattr(resp.message, "tool_calls", None) or []

                if not tool_calls:
                    # Model chose to answer directly — stream the final response.
                    # Re-call with stream=True so we get incremental tokens instead
                    # of blocking until the full response is ready.
                    for chunk in get_client().chat(
                        model=req.model, messages=local_messages, stream=True
                    ):
                        text = chunk.message.content or ""
                        if text:
                            loop.call_soon_threadsafe(
                                queue.put_nowait, _token_event(req.pane_id, text)
                            )
                    return

                # Model called one or more tools — execute them and continue
                local_messages.append({
                    "role": "assistant",
                    "content": resp.message.content or "",
                    "tool_calls": tool_calls,
                })
                for tc in tool_calls:
                    fn = tc.function
                    args = fn.arguments if isinstance(fn.arguments, dict) else {}
                    loop.call_soon_threadsafe(
                        queue.put_nowait,
                        _sse_event({
                            "type": "tool_call",
                            "pane_id": req.pane_id,
                            "payload": {"tool": fn.name, "args": args},
                        }),
                    )
                    if fn.name == "web_search":
                        result, result_sources = _web_search_impl(args.get("query", ""))
                        sources.extend(result_sources)
                    elif fn.name == "fetch_url":
                        result = _fetch_url_impl(args.get("url", ""))
                    else:
                        result = f"Unknown tool: {fn.name}"
                    local_messages.append({"role": "tool", "content": result})

            # Plain stream fallback — used when:
            #   (a) the model doesn't support tools, or
            #   (b) the tool loop exhausted all iterations without a final answer
            for chunk in get_client().chat(model=req.model, messages=local_messages, stream=True):
                content = chunk.message.content or ""
                if content:
                    loop.call_soon_threadsafe(queue.put_nowait, _token_event(req.pane_id, content))

        except asyncio.CancelledError:
            loop.call_soon_threadsafe(queue.put_nowait, _error_event(req.pane_id, "ABORTED"))
        except Exception as e:
            loop.call_soon_threadsafe(queue.put_nowait, _error_event(req.pane_id, "STREAM_ERROR", str(e)))
        finally:
            if sources:
                loop.call_soon_threadsafe(
                    queue.put_nowait,
                    _sse_event({
                        "type": "meta",
                        "pane_id": req.pane_id,
                        "payload": {"context_truncated": truncated, "sources": sources},
                    }),
                )
            loop.call_soon_threadsafe(queue.put_nowait, None)

    await loop.run_in_executor(None, _run_stream)


@router.post("/{pane_id}/{session_id}")
async def chat(pane_id: str, session_id: str, body: ChatRequest, request: Request):
    """
    POST /chat/{pane_id}/{session_id}
    Streams the response as SSE.
    At most one active stream per pane_id (AD-13).
    """
    if pane_id not in VALID_PANE_IDS:
        raise HTTPException(status_code=400, detail=f"pane_id must be one of {VALID_PANE_IDS}")
    # Cancel any existing stream for this pane
    for key in list(_active_streams.keys()):
        if key[0] == pane_id:
            task = _active_streams.pop(key)
            task.cancel()

    queue: asyncio.Queue = asyncio.Queue()
    task = asyncio.create_task(_stream_chat(body, queue))
    _active_streams[(pane_id, session_id)] = task

    async def event_generator() -> AsyncGenerator[dict, None]:
        try:
            while True:
                if await request.is_disconnected():
                    task.cancel()
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=5.0)
                except asyncio.TimeoutError:
                    # Send an SSE comment as a keepalive ping so the browser
                    # does not close the connection during slow tool calls.
                    yield {"comment": "keepalive"}
                    continue
                if event is None:
                    break
                yield event
        finally:
            _active_streams.pop((pane_id, session_id), None)

    return EventSourceResponse(event_generator())


@router.delete("/{pane_id}/{session_id}")
async def abort_chat(pane_id: str, session_id: str):
    """
    DELETE /chat/{pane_id}/{session_id}
    Abort the active stream for this pane+session (AD-13 abort chain).
    """
    key = (pane_id, session_id)
    task = _active_streams.pop(key, None)
    if task:
        task.cancel()
        return {"aborted": True}
    return {"aborted": False}
