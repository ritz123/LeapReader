"""
Ollama lifecycle manager for LeapReader.

Responsibilities:
- Detect a running Ollama server on port 11434 (OLLAMA_PROVENANCE = "external")
- Detect system Ollama on PATH (OLLAMA_PROVENANCE = "path")
- Download bundled Ollama binary if not found (OLLAMA_PROVENANCE = "bundled")
- Start Ollama process and wait for it to be ready
- Watchdog: restart Ollama on crash (up to 2 consecutive failures)
- Shutdown: kill Ollama only if OLLAMA_PROVENANCE == "bundled"
"""

import asyncio
import os
import platform
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

import httpx
import ollama_client as _oc

OLLAMA_HOST = "http://127.0.0.1:11434"
OLLAMA_READY_TIMEOUT = 10.0       # seconds to wait for external / path Ollama
OLLAMA_BUNDLED_READY_TIMEOUT = 30.0  # longer timeout for bundled first-boot
OLLAMA_READY_POLL = 0.25
WATCHDOG_MAX_RESTARTS = 2

# Set once by ensure_ollama(); "external" | "path" | "bundled"
OLLAMA_PROVENANCE: str = ""
_ollama_bin: str = ""
_ollama_proc: subprocess.Popen | None = None
_watchdog_task: asyncio.Task | None = None
_failure_count: int = 0
_sse_stream_callbacks: list = []  # callbacks(event_dict) for SSE error broadcasting


def _user_data_dir() -> Path:
    """Return app user-data dir (mirrors Electron's app.getPath('userData'))."""
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / "leap-reader"


def _bundled_ollama_path() -> Path:
    system = platform.system().lower()
    machine = platform.machine().lower()
    if "arm" in machine or "aarch64" in machine:
        arch = "arm64"
    else:
        arch = "amd64"

    bin_name = "ollama.exe" if system == "windows" else "ollama"
    return _user_data_dir() / "ollama" / "bin" / bin_name


def _ollama_download_url() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()
    if "arm" in machine or "aarch64" in machine:
        arch = "arm64"
    else:
        arch = "amd64"

    base = "https://github.com/ollama/ollama/releases/latest/download"
    if system == "linux":
        return f"{base}/ollama-linux-{arch}"
    elif system == "darwin":
        return f"{base}/ollama-darwin"
    elif system == "windows":
        return f"{base}/ollama-windows-{arch}.exe"
    raise RuntimeError(f"Unsupported OS: {system}")


async def _download_ollama(dest: Path) -> None:
    url = _ollama_download_url()
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"[ollama_manager] Downloading Ollama from {url}", file=sys.stderr, flush=True)

    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _download_sync, url, dest)

    dest.chmod(dest.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    print(f"[ollama_manager] Ollama downloaded to {dest}", file=sys.stderr, flush=True)


def _download_sync(url: str, dest: Path) -> None:
    with urllib.request.urlopen(url, timeout=300) as resp:
        with open(dest, "wb") as f:
            shutil.copyfileobj(resp, f)


def get_host() -> str:
    """Return the currently configured Ollama host URL."""
    return OLLAMA_HOST


async def set_host(url: str) -> bool:
    """
    Point LeapReader at a different Ollama server.
    Verifies connectivity, updates OLLAMA_HOST and the shared client factory.
    Returns True if the server is reachable at the new URL.
    """
    global OLLAMA_HOST, OLLAMA_PROVENANCE
    url = url.rstrip("/")
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(f"{url}/api/tags", timeout=3.0)
            if resp.status_code != 200:
                return False
        except Exception:
            return False
    OLLAMA_HOST = url
    OLLAMA_PROVENANCE = "external"
    _oc.set_client_host(url)
    print(f"[ollama_manager] Host updated to {url}", file=sys.stderr, flush=True)
    return True


async def _is_ollama_already_running() -> bool:
    """Return True if an Ollama server is already answering on the configured host."""
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(f"{OLLAMA_HOST}/api/tags", timeout=2.0)
            return resp.status_code == 200
        except Exception:
            return False


async def ensure_ollama() -> str:
    """
    Detect or download Ollama. Returns resolved binary path, or an empty
    string when an external server is already running.
    Sets module-level OLLAMA_PROVENANCE and _ollama_bin.

    Detection order:
    1. If Ollama is already serving on port 11434 → provenance "external", no binary needed.
    2. If the `ollama` binary is on PATH → provenance "path".
    3. Otherwise download a bundled binary → provenance "bundled".
    """
    global OLLAMA_PROVENANCE, _ollama_bin

    if await _is_ollama_already_running():
        OLLAMA_PROVENANCE = "external"
        _ollama_bin = ""
        _oc.set_client_host(OLLAMA_HOST)
        print(
            "[ollama_manager] External Ollama server detected — skipping binary setup",
            file=sys.stderr,
            flush=True,
        )
        return ""

    system_bin = shutil.which("ollama")
    if system_bin:
        OLLAMA_PROVENANCE = "path"
        _ollama_bin = system_bin
        _oc.set_client_host(OLLAMA_HOST)
        print(f"[ollama_manager] Using system Ollama: {system_bin}", file=sys.stderr, flush=True)
        return system_bin

    bundled = _bundled_ollama_path()
    if not bundled.exists():
        await _download_ollama(bundled)

    OLLAMA_PROVENANCE = "bundled"
    _ollama_bin = str(bundled)
    _oc.set_client_host(OLLAMA_HOST)
    return _ollama_bin


async def _wait_for_ollama_ready(timeout: float = OLLAMA_READY_TIMEOUT) -> bool:
    """Poll Ollama's /api/tags until it responds or timeout expires."""
    deadline = asyncio.get_running_loop().time() + timeout
    async with httpx.AsyncClient() as client:
        while asyncio.get_running_loop().time() < deadline:
            try:
                resp = await client.get(f"{OLLAMA_HOST}/api/tags", timeout=2.0)
                if resp.status_code == 200:
                    return True
            except Exception:
                pass
            await asyncio.sleep(OLLAMA_READY_POLL)
    return False


def _start_ollama_process() -> subprocess.Popen:
    env = os.environ.copy()
    env["OLLAMA_HOST"] = "http://127.0.0.1:11434"
    env["OLLAMA_ORIGINS"] = "*"
    env["OLLAMA_NUM_PARALLEL"] = "1"
    env["OLLAMA_MAX_LOADED_MODELS"] = "1"
    proc = subprocess.Popen(
        [_ollama_bin, "serve"],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return proc


def _broadcast(event: dict) -> None:
    """Send an event dict to all registered SSE callbacks."""
    for cb in _sse_stream_callbacks:
        try:
            cb(event)
        except Exception:
            pass


async def start_ollama(sse_error_cb=None) -> bool:
    """
    Start Ollama and wait for it to be ready.
    Returns True if ready, False on failure.
    Registers sse_error_cb for OLLAMA_CRASH / OLLAMA_READY / OLLAMA_STARTING events.

    When OLLAMA_PROVENANCE == "path" (system install), Ollama is likely already
    running as a system service.  Spawning a second instance would fight for the
    port, exit immediately, and confuse the watchdog into an infinite crash loop.
    Instead we check whether the existing service is reachable and, if so, return
    True without spawning or watching anything.  We only watch processes we own.
    """
    global _ollama_proc, _watchdog_task, _failure_count

    if sse_error_cb:
        _sse_stream_callbacks.append(sse_error_cb)

    _failure_count = 0

    if OLLAMA_PROVENANCE == "external":
        print("[ollama_manager] External Ollama server — skipping spawn", file=sys.stderr, flush=True)
        return True

    if OLLAMA_PROVENANCE == "path":
        # Check whether the system Ollama is already answering before spawning.
        already_up = await _wait_for_ollama_ready()
        if already_up:
            print("[ollama_manager] System Ollama already running — skipping spawn", file=sys.stderr, flush=True)
            return True
        # Not responding yet — try starting it once; the system manages it from here.
        _broadcast({"type": "OLLAMA_STARTING", "payload": {"message": "Starting system Ollama…"}})
        _ollama_proc = _start_ollama_process()
        print(f"[ollama_manager] Started system Ollama (pid={_ollama_proc.pid})", file=sys.stderr, flush=True)
        ready = await _wait_for_ollama_ready(timeout=OLLAMA_BUNDLED_READY_TIMEOUT)
        if ready:
            _oc.set_client_host("http://127.0.0.1:11434")
            _broadcast({"type": "OLLAMA_READY", "payload": {"message": "Ollama is ready"}})
        else:
            print("[ollama_manager] System Ollama did not become ready in time", file=sys.stderr, flush=True)
        return ready

    # Bundled Ollama — we own it, so spawn and watch it.
    _broadcast({"type": "OLLAMA_STARTING", "payload": {"message": "Starting bundled Ollama…"}})
    _ollama_proc = _start_ollama_process()
    print(f"[ollama_manager] Bundled Ollama started (pid={_ollama_proc.pid})", file=sys.stderr, flush=True)

    ready = await _wait_for_ollama_ready(timeout=OLLAMA_BUNDLED_READY_TIMEOUT)
    if not ready:
        print("[ollama_manager] Bundled Ollama did not become ready in time", file=sys.stderr, flush=True)
        _broadcast({"type": "error", "payload": {"code": "OLLAMA_CRASH", "message": "Bundled Ollama failed to start"}})
        return False

    _oc.set_client_host("http://127.0.0.1:11434")
    _broadcast({"type": "OLLAMA_READY", "payload": {"message": "Ollama is ready"}})
    _watchdog_task = asyncio.create_task(_watchdog())
    return True


async def _watchdog():
    """Monitor Ollama process; restart up to WATCHDOG_MAX_RESTARTS times."""
    global _ollama_proc, _failure_count

    while True:
        await asyncio.sleep(1.0)
        if _ollama_proc is None:
            return
        if _ollama_proc.poll() is not None:
            _failure_count += 1
            print(
                f"[ollama_manager] Ollama crashed (failure {_failure_count}/{WATCHDOG_MAX_RESTARTS})",
                file=sys.stderr,
                flush=True,
            )
            if _failure_count > WATCHDOG_MAX_RESTARTS:
                _broadcast({"type": "error", "payload": {"code": "OLLAMA_CRASH", "message": "Ollama repeatedly crashed"}})
                return

            delay = 1.0 if _failure_count == 1 else 5.0
            await asyncio.sleep(delay)
            _ollama_proc = _start_ollama_process()
            ready = await _wait_for_ollama_ready(timeout=OLLAMA_BUNDLED_READY_TIMEOUT)
            if not ready:
                _broadcast({"type": "error", "payload": {"code": "OLLAMA_CRASH", "message": "Ollama restart failed"}})
                return  # Stop watchdog — unresponsive Ollama after restart
            # Reset counter on successful restart so each new uptime gets a fresh budget
            _failure_count = 0


async def stop_ollama():
    """
    Shutdown Ollama.
    Only kills the process if OLLAMA_PROVENANCE == "bundled".
    """
    global _ollama_proc, _watchdog_task

    if _watchdog_task and not _watchdog_task.done():
        _watchdog_task.cancel()
        try:
            await _watchdog_task
        except asyncio.CancelledError:
            pass
        _watchdog_task = None

    if _ollama_proc is None:
        return

    if OLLAMA_PROVENANCE in ("path", "external"):
        print("[ollama_manager] System/external Ollama — leaving process running", file=sys.stderr, flush=True)
        _ollama_proc = None
        return

    proc = _ollama_proc
    _ollama_proc = None
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
    print("[ollama_manager] Bundled Ollama stopped", file=sys.stderr, flush=True)
