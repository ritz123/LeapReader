"""
Shared Ollama client factory for LeapReader.

All backend modules call get_client() instead of using module-level
ollama.xxx() functions so that URL changes made at runtime (via PUT /config/ollama)
propagate everywhere immediately.
"""

import ollama

# Populated by ollama_manager; imported here to avoid circular imports.
_host: str = "http://localhost:11434"


def set_client_host(url: str) -> None:
    """Update the host used by all subsequent get_client() calls."""
    global _host
    _host = url.rstrip("/")


def get_host() -> str:
    return _host


def get_client() -> ollama.Client:
    """Return an ollama.Client configured for the current host."""
    return ollama.Client(host=_host)
