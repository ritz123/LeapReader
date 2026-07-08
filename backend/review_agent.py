"""
Paper Review Agent — Story 3.2

Implements a ReAct (Reasoning + Acting) agent loop using Ollama tool-calling
for comprehensive academic paper review with live citation verification.

Tools available:
  web_search(query: str) → search results
  fetch_url(url: str) → page content

SSE events emitted:
  meta       {context_truncated: bool}
  tool_call  {tool: str, args: {query|url: str}}
  token      {text: str}
  error      {code: str, message: str}
"""

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Callable

import ollama
from ollama_client import get_client

from context_utils import extract_pdf_text
from web_tools import TOOL_DEFINITIONS as INTERNET_TOOLS
from web_tools import web_search as _web_search_impl
from web_tools import fetch_url as _fetch_url_impl

REVIEW_PROMPT_ASSET = os.environ.get("LEAPREADER_ASSETS", "assets") + "/review-prompt.md"
MAX_TOOL_ITERATIONS = 10


def _load_system_prompt() -> str:
    try:
        asset_path = Path(REVIEW_PROMPT_ASSET)
        if asset_path.exists():
            return asset_path.read_text()
    except Exception:
        pass
    return (
        "You are an expert academic peer reviewer. Produce a comprehensive, critical review "
        "of the provided paper including: Summary, Strengths, Detailed Review, Gaps and Limitations, "
        "Suggestions, Citation Suggestions (verify via web search), and Overall Assessment."
    )




async def run_review_agent(
    pdf_path: str,
    model: str,
    pane_id: str,
    sse_cb: Callable[[dict], None],
    offline: bool = False,
) -> None:
    """
    Run the full ReAct review agent.
    sse_cb receives typed SSE event dicts synchronously.
    """
    loop = asyncio.get_running_loop()

    # Extract PDF text
    try:
        paper_text, truncated = await loop.run_in_executor(None, extract_pdf_text, pdf_path)
    except Exception as e:
        sse_cb({"type": "error", "pane_id": pane_id, "payload": {"code": "PDF_READ_ERROR", "message": str(e)}})
        return

    sse_cb({"type": "meta", "pane_id": pane_id, "payload": {"context_truncated": truncated}})

    system_prompt = _load_system_prompt()
    messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": f"Please review the following academic paper:\n\n{paper_text}",
        },
    ]

    # When offline=True, skip all web tools so no network calls are made
    effective_tools = [] if offline else INTERNET_TOOLS

    def _tool_dispatch(name: str, args: dict) -> str:
        if name == "web_search":
            text, _ = _web_search_impl(args.get("query", ""))
            return text
        if name == "fetch_url":
            return _fetch_url_impl(args.get("url", ""))
        return f"Unknown tool: {name}"

    MAX_TOOL_RESULT_CHARS = 4_000  # Cap per tool result to keep history within context window

    def _react_loop():
        for iteration in range(MAX_TOOL_ITERATIONS):
            try:
                # Guard: trim oldest tool messages if history is growing too large
                non_system = [m for m in messages if m.get("role") != "system"]
                total_chars = sum(len(str(m.get("content", ""))) for m in non_system)
                if total_chars > 30_000:
                    # Keep system + user + last 4 messages to stay within context window
                    messages[2:] = messages[-4:]

                try:
                    resp = get_client().chat(
                        model=model,
                        messages=messages,
                        tools=effective_tools if effective_tools else None,
                        stream=False,
                    )
                except ollama.ResponseError as e:
                    if "does not support tools" in str(e).lower():
                        # Fallback: no tool calling — just stream without tools
                        for chunk in get_client().chat(model=model, messages=messages, stream=True):
                            text = chunk.message.content or ""
                            if text:
                                loop.call_soon_threadsafe(
                                    sse_cb,
                                    {"type": "token", "pane_id": pane_id, "payload": {"text": text}},
                                )
                        return
                    raise

                msg = resp.message
                tool_calls = getattr(msg, "tool_calls", None) or []

                if tool_calls:
                    messages.append({"role": "assistant", "content": msg.content or "", "tool_calls": tool_calls})
                    for tc in tool_calls:
                        fn = tc.function
                        tool_name = fn.name
                        args = fn.arguments if isinstance(fn.arguments, dict) else {}
                        # Emit tool_call SSE event
                        loop.call_soon_threadsafe(
                            sse_cb,
                            {
                                "type": "tool_call",
                                "pane_id": pane_id,
                                "payload": {"tool": tool_name, "args": args},
                            },
                        )
                        result = _tool_dispatch(tool_name, args)
                        messages.append({
                            "role": "tool",
                            "content": result[:MAX_TOOL_RESULT_CHARS],
                        })
                    # Continue loop
                else:
                    # Final answer already in resp.message.content — emit it directly
                    # rather than re-prompting (which would cause doubled/hallucinated output)
                    final_text = msg.content or ""
                    if final_text:
                        loop.call_soon_threadsafe(
                            sse_cb,
                            {"type": "token", "pane_id": pane_id, "payload": {"text": final_text}},
                        )
                    return

            except asyncio.CancelledError:
                loop.call_soon_threadsafe(
                    sse_cb,
                    {"type": "error", "pane_id": pane_id, "payload": {"code": "ABORTED"}},
                )
                return
            except Exception as e:
                loop.call_soon_threadsafe(
                    sse_cb,
                    {"type": "error", "pane_id": pane_id, "payload": {"code": "REVIEW_ERROR", "message": str(e)}},
                )
                return

        loop.call_soon_threadsafe(
            sse_cb,
            {"type": "error", "pane_id": pane_id, "payload": {"code": "MAX_ITERATIONS", "message": "Tool loop limit reached"}},
        )

    await loop.run_in_executor(None, _react_loop)
