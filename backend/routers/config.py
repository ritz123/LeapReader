"""
Runtime configuration API for LeapReader.

Endpoints:
  GET  /config/ollama  — return current server URL, provenance, and connectivity
  PUT  /config/ollama  — point LeapReader at a different Ollama server
"""

import ollama_manager
from fastapi import APIRouter
from model_manager import list_local_models
from pydantic import BaseModel

router = APIRouter(prefix="/config", tags=["config"])


class OllamaUrlBody(BaseModel):
    url: str


@router.get("/ollama")
async def get_ollama_config():
    """Return the current Ollama server URL and connection state."""
    connected = await ollama_manager._is_ollama_already_running()
    return {
        "url": ollama_manager.get_host(),
        "provenance": ollama_manager.OLLAMA_PROVENANCE,
        "connected": connected,
    }


@router.put("/ollama")
async def update_ollama_url(body: OllamaUrlBody):
    """
    Switch LeapReader to a different Ollama server.
    Verifies connectivity first; on success returns the model list from the
    new server so the frontend can refresh its dropdown in one round-trip.
    """
    url = body.url.strip()
    if not url.startswith(("http://", "https://")):
        return {"ok": False, "error": "URL must start with http:// or https://"}

    ok = await ollama_manager.set_host(url)
    if not ok:
        return {"ok": False, "error": f"Cannot reach Ollama at {url}"}

    models = await list_local_models()
    return {"ok": True, "url": ollama_manager.get_host(), "models": models}
