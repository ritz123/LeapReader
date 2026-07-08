/**
 * LeapReader AI Bridge — Story 1.2.
 *
 * Spawns the Python FastAPI sidecar, negotiates port via temp file,
 * emits IPC lifecycle events (backend:ready / backend:down / backend:failed),
 * and handles crash recovery with exponential backoff.
 *
 * IPC channels emitted (Main → Renderer via webContents.send):
 *   backend:ready   { port: number }
 *   backend:down    { attempt: number, maxAttempts: number }
 *   backend:failed  { reason: string }
 *
 * IPC handlers registered (Renderer → Main via ipcMain.handle):
 *   ai:get-backend-port  → number | null
 */

import { app, ipcMain, BrowserWindow } from "electron";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT_FILE = path.join(tmpdir(), "leapreader-backend.port");
const PORT_POLL_INTERVAL_MS = 100;
const PORT_POLL_TIMEOUT_MS = 10_000;
const SIGKILL_DELAY_MS = 3_000;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000];

/** @type {import('node:child_process').ChildProcess | null} */
let _proc = null;
/** @type {number | null} */
let _backendPort = null;
let _retryCount = 0;
let _stopped = false;
let _retryTimer = null;

/** Resolve the Python executable and backend script paths. */
function resolvePaths() {
  if (app.isPackaged) {
    const base = path.join(process.resourcesPath, "backend");
    // In a packaged app the resources dir is read-only (AppImage squashfs).
    // The .venv is created on first launch into a writable userData directory.
    const venvPython = path.join(app.getPath("userData"), "backend-venv", "bin", "python");
    return { python: venvPython, script: path.join(base, "main.py"), sourceDir: base };
  }
  const root = path.join(__dirname, "..");
  const base = path.join(root, "backend");
  return { python: path.join(base, ".venv", "bin", "python"), script: path.join(base, "main.py"), sourceDir: base };
}

/**
 * Locate `uv` on PATH or in well-known install locations.
 * Returns the resolved path, or null if not found.
 */
function findUv() {
  const candidates = [
    "uv",
    path.join(homedir(), ".local", "bin", "uv"),
    path.join(homedir(), ".cargo", "bin", "uv"),
    "/usr/local/bin/uv",
    "/opt/homebrew/bin/uv",
  ];
  for (const candidate of candidates) {
    try {
      // A quick synchronous check — just stat the file, no execution needed.
      if (existsSync(candidate)) return candidate;
    } catch { /* skip */ }
  }
  return null;
}

/**
 * Ensure the Python virtual-environment exists.
 *
 * Dev mode  → expects .venv inside the source tree (created by `uv sync`).
 * Packaged  → the resources dir is read-only, so we keep the venv in
 *             userData/backend-venv and create it on first launch via `uv sync`.
 *
 * Emits `backend:setting_up` while the one-time setup runs so the UI can
 * show a progress message instead of a blank/failed state.
 */
async function ensureVenv({ python, sourceDir }) {
  if (existsSync(python)) return; // already good

  if (!app.isPackaged) {
    throw new Error(
      `Python binary not found at: ${python}\nRun 'uv sync' inside the backend/ directory.`
    );
  }

  // ── First-launch setup for packaged app ────────────────────────────────────
  const uv = findUv();
  if (!uv) {
    throw new Error(
      "AI setup requires `uv` (https://docs.astral.sh/uv/).\n" +
      "Install it with: curl -LsSf https://astral.sh/uv/install.sh | sh\n" +
      "Then relaunch the app."
    );
  }

  const venvDir = path.join(app.getPath("userData"), "backend-venv");
  broadcast("backend:setting_up", { message: "Setting up AI environment (first launch)…" });
  console.log(`[ai-bridge] Running uv sync → ${venvDir}`);

  await new Promise((resolve, reject) => {
    const proc = spawn(uv, ["sync", "--project", sourceDir], {
      env: { ...process.env, UV_PROJECT_ENVIRONMENT: venvDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    proc.stdout?.on("data", (d) => process.stdout.write(`[ai-setup] ${d}`));
    proc.stderr?.on("data", (d) => process.stderr.write(`[ai-setup] ${d}`));
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`uv sync exited with code ${code}`));
    });
  });

  if (!existsSync(python)) {
    throw new Error("Python venv setup completed but python binary still not found — please report this as a bug.");
  }
  console.log("[ai-bridge] Python venv ready.");
}

/** Broadcast an IPC event to all open renderer windows. */
function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

/** Poll the port file until the backend writes it or we time out. */
async function waitForPort() {
  const deadline = Date.now() + PORT_POLL_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const check = () => {
      if (_stopped) return reject(new Error("Stopped"));
      try {
        if (existsSync(PORT_FILE)) {
          const raw = readFileSync(PORT_FILE, "utf8").trim();
          const port = parseInt(raw, 10);
          if (!isNaN(port) && port > 0) return resolve(port);
        }
      } catch {
        /* file not ready yet */
      }
      if (Date.now() > deadline) return reject(new Error("Port file timeout"));
      setTimeout(check, PORT_POLL_INTERVAL_MS);
    };
    check();
  });
}

/**
 * Poll /health on the given port until it responds 200 or we time out.
 * Ensures the backend is actually accepting connections before emitting backend:ready.
 */
async function waitForHttp(port) {
  const { default: http } = await import("node:http");
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (_stopped) throw new Error("Stopped");
    const ok = await new Promise((resolve) => {
      const req = http.get(
        { host: "127.0.0.1", port, path: "/health", timeout: 1000 },
        (res) => { res.resume(); resolve(res.statusCode === 200); }
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => { req.destroy(); resolve(false); });
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("HTTP readiness probe timed out");
}

/** Spawn the sidecar process. Does NOT handle retries — call spawnWithRetry instead. */
async function spawnOnce(windows) {
  const paths = resolvePaths();
  const { python, script } = paths;

  await ensureVenv(paths);

  // Clean up stale port file
  try {
    if (existsSync(PORT_FILE)) unlinkSync(PORT_FILE);
  } catch {
    /* ignore */
  }

  const childEnv = { ...process.env, LEAPREADER_PORT: "0" };

  // When running from an AppImage the runtime prepends AppImage-internal
  // paths to LD_LIBRARY_PATH so that Electron finds its bundled libraries.
  // The Python subprocess does not need those paths and they can shadow
  // system networking libraries (libssl, libcrypto, etc.), silently
  // breaking httpx connections to localhost.  Strip them here.
  if (process.env.APPDIR && childEnv.LD_LIBRARY_PATH) {
    const appdir = process.env.APPDIR;
    const filtered = childEnv.LD_LIBRARY_PATH
      .split(":")
      .filter((p) => p && !p.startsWith(appdir))
      .join(":");
    if (filtered) {
      childEnv.LD_LIBRARY_PATH = filtered;
    } else {
      delete childEnv.LD_LIBRARY_PATH;
    }
  }

  _proc = spawn(python, [script], {
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
    // detached: false (default) — on SIGKILL, OS will also reap child processes on Linux/macOS
    // Use a process group so that SIGTERM propagates to Ollama child
    detached: false,
  });

  _proc.stdout?.on("data", (d) => process.stdout.write(`[ai-backend] ${d}`));
  _proc.stderr?.on("data", (d) => {
    const text = d.toString();
    for (const line of text.split("\n")) {
      if (line.startsWith("PULL_PROGRESS:")) {
        try {
          const event = JSON.parse(line.slice("PULL_PROGRESS:".length));
          broadcast("backend:pull_progress", event);
        } catch {
          /* malformed — ignore */
        }
      } else if (line.trim()) {
        process.stderr.write(`[ai-backend] ${line}\n`);
      }
    }
  });

  // Wait for port file (signals uvicorn has bound the socket and is ready)
  const port = await waitForPort();
  // HTTP readiness probe — confirms the server is actually accepting requests
  await waitForHttp(port);
  _backendPort = port;
  broadcast("backend:ready", { port });

  // Listen for unexpected exit (any non-null exit code, including 0, is unexpected mid-session)
  _proc.on("exit", (code) => {
    if (_stopped) return;
    if (code !== null) {
      _backendPort = null;
      broadcast("backend:down", { attempt: _retryCount + 1, maxAttempts: MAX_RETRIES });
      scheduleRetry(windows);
    }
  });
}

function scheduleRetry(windows) {
  if (_stopped || _retryCount >= MAX_RETRIES) {
    broadcast("backend:failed", {
      reason: `Backend failed to start after ${MAX_RETRIES} attempts.`,
    });
    return;
  }
  const delay = RETRY_DELAYS_MS[_retryCount] ?? 10_000;
  _retryCount++;
  _retryTimer = setTimeout(() => {
    if (!_stopped) spawnOnce(windows).catch(() => scheduleRetry(windows));
  }, delay);
}

/**
 * Start the Python FastAPI sidecar.
 * Should be called once from `app.whenReady()`, after `createWindow`.
 */
export async function startBackend() {
  _stopped = false;
  _retryCount = 0;

  // Register query handler
  ipcMain.handle("ai:get-backend-port", () => _backendPort);

  // Abort IPC relay: renderer sends ai:abort:{pane_id} → Main → DELETE on all stream endpoints
  for (const side of ["left", "right"]) {
    ipcMain.handle(`ai:abort:${side}`, async (_event, { session_id, stream_type = "chat" }) => {
      const port = _backendPort;
      if (!port || !session_id) return { aborted: false };
      const endpoint = `/${stream_type}/${side}/${session_id}`;
      try {
        const { default: http } = await import("node:http");
        await new Promise((resolve) => {
          const req = http.request(
            { host: "127.0.0.1", port, method: "DELETE", path: endpoint },
            (res) => { res.resume(); res.on("end", resolve); }
          );
          req.on("error", resolve);
          req.end();
        });
        return { aborted: true };
      } catch {
        return { aborted: false };
      }
    });
  }

  try {
    await spawnOnce(BrowserWindow.getAllWindows());
  } catch (err) {
    broadcast("backend:failed", { reason: String(err?.message ?? err) });
  }
}

/**
 * Stop the Python FastAPI sidecar gracefully.
 * Called from `app.on('before-quit')`.
 */
export async function stopBackend() {
  _stopped = true;
  if (_retryTimer) {
    clearTimeout(_retryTimer);
    _retryTimer = null;
  }
  if (!_proc) return;
  const proc = _proc;
  _proc = null;
  _backendPort = null;

  return new Promise((resolve) => {
    const killTimer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* already dead */
      }
      resolve();
    }, SIGKILL_DELAY_MS);

    proc.once("exit", () => {
      clearTimeout(killTimer);
      resolve();
    });

    try {
      // SIGTERM the whole process group so the Python-managed Ollama child is
      // also cleanly terminated before the SIGKILL fallback fires (EC-17).
      proc.kill("SIGTERM");
    } catch {
      clearTimeout(killTimer);
      resolve();
    }
  });
}

/**
 * Return the port the sidecar is listening on, or null if not started.
 * @returns {number|null}
 */
export function getBackendPort() {
  return _backendPort;
}
