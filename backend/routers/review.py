"""
Review API — POST /review/{pane_id}/{session_id}
Streams the paper review as SSE via the ReAct agent.
"""

import asyncio
import json
import os
from pathlib import Path
from typing import AsyncGenerator

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from model_manager import DEFAULT_MODEL
from review_agent import run_review_agent

router = APIRouter(prefix="/review", tags=["review"])

_active_streams: dict[tuple[str, str], asyncio.Task] = {}

VALID_PANE_IDS = {"left", "right"}


class ReviewRequest(BaseModel):
    pane_id: str
    session_id: str
    pdf_path: str
    model: str = DEFAULT_MODEL
    offline: bool = False


def _validate_pdf_path(pdf_path: str) -> str:
    """Resolve and validate that pdf_path points to an existing file within allowed dirs."""
    resolved = Path(pdf_path).resolve()
    # Allow files only within the OS temp dir or the user's home directory
    allowed_roots = [
        Path(os.path.expanduser("~")).resolve(),
        Path(os.environ.get("TMPDIR", "/tmp")).resolve(),
        Path("/tmp").resolve(),
    ]
    if not any(str(resolved).startswith(str(root)) for root in allowed_roots):
        raise HTTPException(status_code=400, detail="Invalid pdf_path: outside allowed directories")
    if not resolved.exists() or not resolved.is_file():
        raise HTTPException(status_code=400, detail="pdf_path does not exist or is not a file")
    if resolved.suffix.lower() not in (".pdf",):
        raise HTTPException(status_code=400, detail="pdf_path must be a .pdf file")
    return str(resolved)


@router.post("/{pane_id}/{session_id}")
async def review(pane_id: str, session_id: str, body: ReviewRequest, request: Request):
    if pane_id not in VALID_PANE_IDS:
        raise HTTPException(status_code=400, detail=f"pane_id must be one of {VALID_PANE_IDS}")
    pdf_path = _validate_pdf_path(body.pdf_path)
    for key in list(_active_streams.keys()):
        if key[0] == pane_id:
            _active_streams.pop(key).cancel()

    queue: asyncio.Queue = asyncio.Queue()

    def on_event(event: dict) -> None:
        queue.put_nowait({"data": json.dumps(event)})

    async def _run():
        try:
            await run_review_agent(pdf_path, body.model, pane_id, on_event, offline=body.offline)
        finally:
            queue.put_nowait(None)

    task = asyncio.create_task(_run())
    _active_streams[(pane_id, session_id)] = task

    async def gen() -> AsyncGenerator[dict, None]:
        try:
            while True:
                if await request.is_disconnected():
                    task.cancel()
                    break
                try:
                    evt = await asyncio.wait_for(queue.get(), timeout=60.0)
                except asyncio.TimeoutError:
                    continue
                if evt is None:
                    break
                yield evt
        finally:
            _active_streams.pop((pane_id, session_id), None)

    return EventSourceResponse(gen())


@router.delete("/{pane_id}/{session_id}")
async def abort_review(pane_id: str, session_id: str):
    task = _active_streams.pop((pane_id, session_id), None)
    if task:
        task.cancel()
        return {"aborted": True}
    return {"aborted": False}
