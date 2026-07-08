"""
Summarize API — POST /summarize/{pane_id}/{session_id}
Streams a summary of the provided text as SSE token events.
"""

import asyncio
import json
from typing import AsyncGenerator

from fastapi import APIRouter, Request
from ollama_client import get_client
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from context_utils import trim_to_tokens
from model_manager import DEFAULT_MODEL

router = APIRouter(prefix="/summarize", tags=["summarize"])

_active_streams: dict[tuple[str, str], asyncio.Task] = {}

SUMMARIZE_SYSTEM = (
    "You are an expert academic assistant. "
    "Produce a concise, structured summary of the following document text. "
    "Include: main contribution, key findings, methodology, and conclusions. "
    "Be clear and precise."
)


class SummarizeRequest(BaseModel):
    pane_id: str
    session_id: str
    context_text: str
    model: str = DEFAULT_MODEL


def _sse(event: dict) -> dict:
    return {"data": json.dumps(event)}


async def _stream_summary(req: SummarizeRequest, queue: asyncio.Queue) -> None:
    loop = asyncio.get_running_loop()
    context_text, truncated = trim_to_tokens(req.context_text)

    await queue.put(_sse({"type": "meta", "pane_id": req.pane_id, "payload": {"context_truncated": truncated}}))

    messages = [
        {"role": "system", "content": SUMMARIZE_SYSTEM},
        {"role": "user", "content": f"Summarize this document:\n\n{context_text}"},
    ]

    def _run():
        try:
            for chunk in get_client().chat(model=req.model, messages=messages, stream=True):
                text = chunk.message.content or ""
                if text:
                    loop.call_soon_threadsafe(
                        queue.put_nowait,
                        _sse({"type": "token", "pane_id": req.pane_id, "payload": {"text": text}}),
                    )
        except Exception as e:
            loop.call_soon_threadsafe(
                queue.put_nowait,
                _sse({"type": "error", "pane_id": req.pane_id, "payload": {"code": "STREAM_ERROR", "message": str(e)}}),
            )
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    await loop.run_in_executor(None, _run)


@router.post("/{pane_id}/{session_id}")
async def summarize(pane_id: str, session_id: str, body: SummarizeRequest, request: Request):
    for key in list(_active_streams.keys()):
        if key[0] == pane_id:
            _active_streams.pop(key).cancel()

    queue: asyncio.Queue = asyncio.Queue()
    task = asyncio.create_task(_stream_summary(body, queue))
    _active_streams[(pane_id, session_id)] = task

    async def gen() -> AsyncGenerator[dict, None]:
        try:
            while True:
                if await request.is_disconnected():
                    task.cancel()
                    break
                try:
                    evt = await asyncio.wait_for(queue.get(), timeout=30.0)
                except asyncio.TimeoutError:
                    continue
                if evt is None:
                    break
                yield evt
        finally:
            _active_streams.pop((pane_id, session_id), None)

    return EventSourceResponse(gen())


@router.delete("/{pane_id}/{session_id}")
async def abort_summarize(pane_id: str, session_id: str):
    task = _active_streams.pop((pane_id, session_id), None)
    if task:
        task.cancel()
        return {"aborted": True}
    return {"aborted": False}
