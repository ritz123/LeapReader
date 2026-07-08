"""
Model management for LeapReader.

Handles ensuring the default model is present and pulling models with
progress events streamed as SSE pull_progress events.
"""

import asyncio
import os
import platform
import sys
from pathlib import Path
from typing import Callable

from ollama_client import get_client

DEFAULT_MODEL = "llama3.2:3b"


async def ensure_model(
    model: str = DEFAULT_MODEL,
    pane_id: str = "left",
    progress_cb: Callable[[dict], None] | None = None,
) -> bool:
    """
    Ensure `model` is available locally.
    If not, pull it and emit pull_progress events via progress_cb.

    Returns True when model is ready, False on failure.
    All blocking Ollama SDK calls run in an executor thread so the event loop
    is never stalled (fixes EC-02).
    progress_cb receives SSE event dicts:
        {type: "pull_progress", pane_id: str, payload: {model, percent, status}}
    """
    if not model:
        print("[model_manager] Empty model name — skipping", file=sys.stderr, flush=True)
        return False

    loop = asyncio.get_running_loop()

    def _list_models():
        return get_client().list()

    try:
        local_models = await loop.run_in_executor(None, _list_models)
        names = [m.model for m in local_models.models]
        if any(model in n for n in names):
            print(f"[model_manager] Model {model} already present", file=sys.stderr, flush=True)
            if progress_cb:
                try:
                    progress_cb({
                        "type": "pull_progress",
                        "pane_id": pane_id,
                        "payload": {"model": model, "percent": 100, "status": "already_present"},
                    })
                except Exception:
                    pass
            return True
    except Exception as e:
        print(f"[model_manager] Could not list models: {e}", file=sys.stderr, flush=True)

    print(f"[model_manager] Pulling model {model}…", file=sys.stderr, flush=True)

    def _pull():
        for chunk in get_client().pull(model, stream=True):
            status = getattr(chunk, "status", "")
            total = getattr(chunk, "total", 0) or 0
            completed = getattr(chunk, "completed", 0) or 0
            percent = round((completed / total) * 100) if total > 0 else 0

            event = {
                "type": "pull_progress",
                "pane_id": pane_id,
                "payload": {
                    "model": model,
                    "percent": percent,
                    "status": status,
                },
            }
            if progress_cb:
                try:
                    progress_cb(event)
                except Exception:
                    pass

    try:
        await loop.run_in_executor(None, _pull)
        print(f"[model_manager] Pull complete: {model}", file=sys.stderr, flush=True)
        return True
    except Exception as e:
        print(f"[model_manager] Pull failed: {e}", file=sys.stderr, flush=True)
        return False


def _ollama_models_dir() -> Path:
    """Return the directory where Ollama stores model manifests."""
    env_override = os.environ.get("OLLAMA_MODELS")
    if env_override:
        return Path(env_override)
    system = platform.system().lower()
    if system == "windows":
        return Path(os.environ.get("USERPROFILE", Path.home())) / ".ollama" / "models"
    if system == "darwin":
        return Path.home() / ".ollama" / "models"
    return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "ollama" / "models"


def _scan_local_model_files() -> list[dict]:
    """
    Scan the Ollama models directory for locally stored model manifests.
    Used as a fallback when the Ollama server is not reachable.
    Returns model dicts with name/size/modified_at (size and modified_at may be 0/"").
    """
    manifests_root = _ollama_models_dir() / "manifests"
    if not manifests_root.exists():
        return []

    models: list[dict] = []
    # Walk all registry/namespace/name/tag paths under manifests/
    for registry_dir in manifests_root.iterdir():
        if not registry_dir.is_dir():
            continue
        for namespace_dir in registry_dir.iterdir():
            if not namespace_dir.is_dir():
                continue
            for model_dir in namespace_dir.iterdir():
                if not model_dir.is_dir():
                    continue
                for tag_file in model_dir.iterdir():
                    if not tag_file.is_file():
                        continue
                    stat = tag_file.stat()
                    models.append({
                        "name": f"{model_dir.name}:{tag_file.name}",
                        "size": stat.st_size,
                        "modified_at": str(stat.st_mtime),
                    })

    models.sort(key=lambda m: m["name"])
    return models


async def list_local_models() -> list[dict]:
    """
    Return list of locally available Ollama models.

    Queries the running Ollama server first.  If the server is unreachable,
    falls back to scanning the local model manifest files on disk so the UI
    can still show what is available without a live server.
    """
    loop = asyncio.get_running_loop()

    def _list():
        return get_client().list()

    try:
        result = await loop.run_in_executor(None, _list)
        return [
            {
                "name": m.model,
                "size": getattr(m, "size", 0),
                "modified_at": str(getattr(m, "modified_at", "")),
            }
            for m in result.models
        ]
    except Exception as e:
        print(
            f"[model_manager] Server list failed: {e} — falling back to local file scan",
            file=sys.stderr,
            flush=True,
        )
        return await loop.run_in_executor(None, _scan_local_model_files)
