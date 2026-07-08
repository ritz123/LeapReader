"""Model management API endpoints."""

import asyncio
from typing import AsyncGenerator

from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse

from model_manager import DEFAULT_MODEL, ensure_model, list_local_models

router = APIRouter(prefix="/models", tags=["models"])


@router.get("/")
async def get_models():
    """List all locally available Ollama models."""
    return {"models": await list_local_models()}


@router.get("/pull/{model:path}")
async def pull_model_sse(model: str, pane_id: str = "left", request: Request = None):
    """
    SSE endpoint: pull a model and stream pull_progress events.
    Client subscribes to GET /models/pull/{model}?pane_id=left
    and receives events:
        {type: "pull_progress", pane_id, payload: {model, percent, status}}
    """
    queue: asyncio.Queue[dict | None] = asyncio.Queue()

    def on_progress(event: dict):
        queue.put_nowait(event)

    async def _run_pull():
        await ensure_model(model, pane_id, on_progress)
        queue.put_nowait(None)  # sentinel

    pull_task: asyncio.Task = asyncio.create_task(_run_pull())

    async def event_generator() -> AsyncGenerator[dict, None]:
        try:
            while True:
                if request and await request.is_disconnected():
                    pull_task.cancel()
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=5.0)
                except asyncio.TimeoutError:
                    continue
                if event is None:
                    break
                yield {"data": __import__("json").dumps(event)}
        finally:
            pull_task.cancel()

    return EventSourceResponse(event_generator())
