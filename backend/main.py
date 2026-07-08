"""LeapReader AI Backend — FastAPI sidecar for Ollama integration."""

import os
import sys
import tempfile
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from model_manager import DEFAULT_MODEL, ensure_model
from ollama_manager import ensure_ollama, start_ollama, stop_ollama

# Shared queue for broadcasting pull_progress events to the IPC relay
import asyncio
import json

_pull_progress_queue: asyncio.Queue = asyncio.Queue()


@asynccontextmanager
async def lifespan(app: FastAPI):
    port = int(os.environ.get("LEAPREADER_PORT", 0))
    port_file = None
    if port:
        port_file = os.path.join(tempfile.gettempdir(), "leapreader-backend.port")

    # Ensure Ollama binary exists (downloads if missing)
    try:
        await ensure_ollama()
        ollama_ready = await start_ollama()
        if not ollama_ready:
            print(
                "[main] WARNING: Ollama did not start successfully — AI features may be unavailable",
                file=sys.stderr,
                flush=True,
            )
    except Exception as e:
        print(f"[main] Ollama setup failed: {e}", file=sys.stderr, flush=True)

    # Write port file here — lifespan startup fires after uvicorn has bound the
    # socket, which is safe for the Electron bridge's waitForPort() poll.
    if port_file:
        with open(port_file, "w") as f:
            f.write(str(port))
        print(f"BACKEND_READY:{port}", file=sys.stderr, flush=True)

    # Auto-pull default model (non-blocking — progress streamed via SSE)
    def _pull_cb(event: dict):
        # Print to stderr so ai-bridge.mjs can relay as backend:pull_progress IPC
        print(f"PULL_PROGRESS:{json.dumps(event)}", file=sys.stderr, flush=True)

    # pane_id="startup" doesn't match "left" or "right", so ai-panel.ts
    # broadcasts progress to both panes instead of just the left one.
    asyncio.create_task(ensure_model(DEFAULT_MODEL, pane_id="startup", progress_cb=_pull_cb))

    yield

    await stop_ollama()
    if port_file:
        try:
            os.remove(port_file)
        except OSError:
            pass


app = FastAPI(title="LeapReader AI Backend", version="0.1.0", lifespan=lifespan)

from routers import models as models_router  # noqa: E402
from routers import chat as chat_router  # noqa: E402
from routers import summarize as summarize_router  # noqa: E402
from routers import review as review_router  # noqa: E402
from routers import config as config_router  # noqa: E402
app.include_router(models_router.router)
app.include_router(chat_router.router)
app.include_router(summarize_router.router)
app.include_router(review_router.router)
app.include_router(config_router.router)

app.add_middleware(
    CORSMiddleware,
    # The Electron renderer loads from http://127.0.0.1:<static-port> (a different
    # origin than the dynamic backend port), so we allow any local port on
    # 127.0.0.1 / localhost.  "null" covers file:// or sandboxed iframe origins.
    allow_origins=["null"],
    allow_origin_regex=r"https?://(127\.0\.0\.1|localhost)(:\d+)?",
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}


def find_free_port() -> int:
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return s.getsockname()[1]


if __name__ == "__main__":
    port_env = os.environ.get("LEAPREADER_PORT", "0")
    port = int(port_env) if port_env != "0" else find_free_port()
    print(f"LeapReader backend starting on port {port}", file=sys.stderr, flush=True)
    # Expose the chosen port to the lifespan context manager via env so it can
    # write the port file after uvicorn has bound the socket.
    os.environ["LEAPREADER_PORT"] = str(port)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
