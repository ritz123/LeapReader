# Story 1.2: Python Backend Process Lifecycle

---
baseline_commit: 66a66a5
---

Status: review

## Story

As a developer,
I want the Electron app to spawn the Python FastAPI backend as a child process and communicate its port to the renderer,
so that the PDF reader can show AI panel status and later route AI requests to the backend.

## Acceptance Criteria

1. **Given** the app launches **When** `electron/ai-bridge.mjs` `startBackend()` runs **Then** it spawns `backend/.venv/bin/python backend/main.py` (dev) or `resources/backend/.venv/bin/python resources/backend/main.py` (packaged) with env `LEAPREADER_PORT=0` and successfully starts a FastAPI server.

2. **Given** the backend has written its port to `{os.tmpdir()}/leapreader-backend.port` **When** `ai-bridge.mjs` polls at 100 ms intervals (up to 10 s) **Then** on success it emits IPC `backend:ready` with `{port: number}` to all renderer windows.

3. **Given** the Electron window closes **When** `app.on('before-quit')` fires **Then** `stopBackend()` is called, which sends SIGTERM to the Python process and SIGKILL after 3 s if it hasn't exited.

4. **Given** the backend crashes with non-zero exit **When** `ai-bridge.mjs` detects it **Then** it emits IPC `backend:down` and retries spawn up to 3× with delays 2s / 5s / 10s; after 3 failures it emits `backend:failed` and stops retrying.

5. **Given** the backend is unavailable **When** the user opens the PDF reader **Then** it is fully functional; no crash, no hang. (The AI panel stub from Story 2.1 will show "AI unavailable" — for now the renderer simply receives no `backend:ready` event.)

## Tasks / Subtasks

- [x] Task 1: Implement `startBackend` in `electron/ai-bridge.mjs` (AC: 1, 2)
  - [x] Detect dev vs packaged: `app.isPackaged` → `process.resourcesPath/backend` else `path.join(__dirname,'../backend')`
  - [x] Spawn Python via `child_process.spawn` with env `{...process.env, LEAPREADER_PORT:'0'}`
  - [x] Poll `{tmpdir}/leapreader-backend.port` every 100 ms (up to 100 × = 10 s); on read, emit `backend:ready` to all windows
  - [x] If poll times out, treat as crash → go to retry logic

- [x] Task 2: Implement crash recovery and `backend:down` / `backend:failed` IPC (AC: 4)
  - [x] Listen to sidecar `process.on('exit')` (non-zero code → crash)
  - [x] Retry with backoff: attempt 1 → 2s delay, attempt 2 → 5s, attempt 3 → 10s
  - [x] After 3rd failure emit `backend:failed` to all windows and stop retrying
  - [x] After each crash before retry: emit `backend:down` to all windows

- [x] Task 3: Implement `stopBackend` (AC: 3)
  - [x] On `app.on('before-quit')`: call `stopBackend()` → SIGTERM sidecar; wait up to 3 s; SIGKILL if still alive
  - [x] Note: Ollama shutdown logic is NOT here (that is Story 1.3 — `ollama_manager.py`)

- [x] Task 4: Wire `ai-bridge.mjs` into `electron/main.mjs` (AC: 1–5)
  - [x] Import `startBackend`, `stopBackend` from `./ai-bridge.mjs`
  - [x] Call `startBackend()` inside `app.whenReady()` after `createWindow`
  - [x] Add `stopBackend()` call inside `app.on('before-quit')` before `server?.close()`
  - [x] `ai:get-backend-port` IPC handler registered in ai-bridge.mjs `startBackend()`

- [x] Task 5: Expose IPC channels via `preload.cjs` (AC: 2)
  - [x] `window.leapReaderAI` exposed with `getBackendPort`, `onBackendReady`, `onBackendDown`, `onBackendFailed`
  - [x] Each `on*` returns a cleanup function using `ipcRenderer.removeListener`

- [x] Task 6: Run existing test suite for regressions (AC: all)
  - [x] `npm test` → 73/73 pass

## Dev Notes

### Electron Architecture (AD-1, AD-4, AD-5)
- The sidecar is a child process of the Electron Main process, not the renderer.
- Use `child_process.spawn` (not `exec`) for streaming stdout/stderr.
- Port negotiation: backend writes port to `{tmpdir}/leapreader-backend.port` after binding. Bridge polls the file (not stdout) — simpler and avoids readline parsing.
- IPC naming convention (from Architecture Spine): `backend:ready`, `backend:down`, `backend:failed`, `ai:get-backend-port`, `ai:stream:{pane_id}`, `ai:abort:{pane_id}`.

### Python binary path (packaged vs dev)
```javascript
// dev
const pythonBin = path.join(__dirname, '..', 'backend', '.venv', 'bin', 'python');
const scriptPath = path.join(__dirname, '..', 'backend', 'main.py');
// packaged
const base = path.join(process.resourcesPath, 'backend');
const pythonBin = path.join(base, '.venv', 'bin', 'python');
const scriptPath = path.join(base, 'main.py');
```
Use `app.isPackaged` to choose.

### Existing `main.mjs` patterns to follow
- IPC handlers use `ipcMain.handle(channel, async (_event, payload) => {...})` pattern.
- `app.on('before-quit')` already has `globalShortcut.unregisterAll()` and `server?.close()`. Add `stopBackend()` call before `server?.close()`.
- All windows list: `BrowserWindow.getAllWindows()` — use this instead of holding a reference.
- Single instance lock is already implemented — no changes needed there.

### preload.cjs patterns (existing)
- All existing preload APIs live on named objects (e.g. `contextBridge.exposeInMainWorld('leapReaderStorage', {...})`).
- Add `contextBridge.exposeInMainWorld('leapReaderAI', {...})` — do NOT modify existing `leapReaderStorage` or `leapReaderFS` APIs.
- Use `ipcRenderer.on(channel, (_event, data) => cb(data))` pattern for event listeners.
- Expose a `removeListener` function alongside each `on` for cleanup.

### Port file cleanup
- The backend's `main.py` already writes the port file in `if __name__ == '__main__':` block.
- The bridge should clean up the port file on stop (optional, defensive).

### Error handling
- If `pythonBin` does not exist at startup (uv venv not built), emit `backend:failed` immediately with a helpful error message.
- Log sidecar stdout/stderr to the Electron console (not to file — Story 1.5 level concern).

### References
- [Source: ARCHITECTURE-SPINE.md#AD-1] Sidecar process boundary
- [Source: ARCHITECTURE-SPINE.md#AD-4] Process ownership and crash recovery
- [Source: ARCHITECTURE-SPINE.md#AD-5] Port negotiation via temp file
- [Source: ARCHITECTURE-SPINE.md#IPC-Naming] IPC channel naming convention
- [Source: electron/main.mjs] Existing window/server/IPC patterns
- [Source: electron/preload.cjs] Existing preload API patterns
- [Source: backend/main.py] Port file write location and format

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-5

### Debug Log References

### Completion Notes List

- ✅ Full `ai-bridge.mjs` implemented: spawn, port-file polling (100ms/10s), `backend:ready` IPC
- ✅ Crash recovery: `process.on('exit')` listener, 3 retries at 2/5/10s backoff, `backend:down` + `backend:failed` IPC
- ✅ `stopBackend`: SIGTERM + 3s SIGKILL watchdog
- ✅ `main.mjs` wired: `startBackend()` called after `createWindow`, `stopBackend()` in `before-quit`
- ✅ `preload.cjs`: `window.leapReaderAI` API with `getBackendPort`, `onBackendReady`, `onBackendDown`, `onBackendFailed`
- ✅ 73/73 existing vitest tests pass

### File List

- electron/ai-bridge.mjs (MODIFIED — full implementation replacing stub)
- electron/main.mjs (MODIFIED — import + wire startBackend/stopBackend)
- electron/preload.cjs (MODIFIED — add leapReaderAI contextBridge API)
