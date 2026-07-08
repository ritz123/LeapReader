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
import { tmpdir } from "node:os";
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
    return {
      python: path.join(base, ".venv", "bin", "python"),
      script: path.join(base, "main.py"),
    };
  }
  const root = path.join(__dirname, "..");
  return {
    python: path.join(root, "backend", ".venv", "bin", "python"),
    script: path.join(root, "backend", "main.py"),
  };
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
  const { python, script } = resolvePaths();

  if (!existsSync(python)) {
    throw new Error(
      `Python binary not found at: ${python}\nRun 'uv sync' inside the backend/ directory.`
    );
  }

  // Clean up stale port file
  try {
    if (existsSync(PORT_FILE)) unlinkSync(PORT_FILE);
  } catch {
    /* ignore */
  }

  _proc = spawn(python, [script], {
    env: { ...process.env, LEAPREADER_PORT: "0" },
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
