# Solution Design — LeapReader AI Research Assistant

**Status:** draft · **Date:** 2026-07-07  
**Author:** Bisarkar · **Spine:** `ARCHITECTURE-SPINE.md`

---

## 1. What We Are Building

LeapReader is a split-pane PDF reader running as an Electron desktop app. This feature adds a local AI research assistant — no cloud, no API keys, no manual setup — using a quantized Llama model running on CPU via Ollama.

Each PDF pane gets its own independent chat panel at the bottom. The left pane's chat talks to the left document; the right pane's chat talks to the right document. Users get three things:

1. **Summarize** — a structured four-heading summary of the open paper (Problem / Method / Key Results / Limitations), generated in under 45 seconds.
2. **Review** — a full academic peer review with citation verification, powered by a ReAct agent that autonomously searches the web and fetches DOI pages while reasoning.
3. **Free-form chat** — ask anything about the paper, optionally grounded with a live DuckDuckGo search.

Everything runs locally. On first launch, the app downloads Ollama and the default model automatically and silently, with progress visible in the chat panel.

---

## 2. System Architecture

### 2.1 Process Model

The system is three OS processes:

```
┌─────────────────────────────────────────────────────┐
│  Electron App                                       │
│                                                     │
│  ┌─────────────────────┐   ┌─────────────────────┐  │
│  │  Renderer Process   │   │  Main Process       │  │
│  │  (TypeScript/Vite)  │◄──┤  (Node)             │  │
│  │                     │   │  ai-bridge.mjs      │  │
│  │  PaneChatPanel (L)  │   └──────────┬──────────┘  │
│  │  PaneChatPanel (R)  │              │ HTTP/SSE     │
│  │  ModelBrowser       │              │ localhost    │
│  └─────────────────────┘              ▼             │
└───────────────────────────────────────────────────  │
                               ┌─────────────────────┐│
                               │  Python Sidecar     ││
                               │  (FastAPI/uvicorn)  ││
                               │                     ││
                               │  chat_router        ││
                               │  review_agent       ││
                               │  web_tools          ││
                               │  ollama_manager     ││
                               └──────────┬──────────┘│
                                          │ HTTP REST  │
                                          ▼            │
                               ┌─────────────────────┐│
                               │  Ollama Runtime     ││
                               │  localhost:11434    ││
                               │                     ││
                               │  llama3.2:3b-q4_K_M ││
                               └─────────────────────┘│
```

The **Renderer** never talks to the backend directly. All AI requests flow: Renderer → IPC → Main → HTTP → Python Sidecar → Ollama. SSE streams flow back the same path in reverse.

### 2.2 Startup Sequence

```
App launch
    │
    ├─ Main spawns Python sidecar (ai-bridge.mjs)
    │       │
    │       ├─ Sidecar starts FastAPI on random port
    │       ├─ Writes port to {temp}/leapreader-backend.port
    │       └─ Main polls file, emits IPC "backend:ready:{port}"
    │
    ├─ Renderer shows PDF reader (immediately usable)
    │   └─ PaneChatPanel shows "Starting AI engine…"
    │
    ├─ Python sidecar: Ollama Manager runs
    │       ├─ Check PATH for existing ollama binary
    │       │   └─ If found: use it
    │       │   └─ If not: download to userData/ollama/bin/
    │       ├─ Start Ollama process
    │       └─ Check for llama3.2:3b (Q4_K_M)
    │           └─ If missing: pull with progress → SSE meta events
    │
    └─ PaneChatPanel shows "Ready" — user can chat
```

The PDF reader is fully functional at step 2. The AI readiness is a background concern.

---

## 3. Data Flow

### 3.1 Free-Form Chat

```
User types message → clicks Send
    │
    ▼
Renderer: PaneChatPanel
    - Reads pdfjs text layer from pane (≤ 8,000 tokens)
    - POST {backend}/chat  {pane_id, session_id, message, context_text, web_search: bool}
    │
    ▼
Main: ai-bridge.mjs relays request
    │
    ▼
Backend: chat_router.py
    - If web_search=true:  web_tools.web_search(message) → inject snippets
    - Build prompt: [system] + [context] + [history] + [user message]
    - ollama.chat(stream=True) → SSE token stream
    │
    ▼
SSE: {type:"token", pane_id:"left", payload:{text:"…"}}
    └─ IPC "ai:stream:left" → PaneChatPanel renders token
```

### 3.2 Review (Web Mode)

```
User clicks "Review"
    │
    ▼
Renderer: sends PDF file path via IPC → Main → POST {backend}/review
    {pane_id, session_id, pdf_path, offline: false}
    │
    ▼
Backend: chat_router.py → review_agent.py
    │
    ├─ context_utils.py: pypdf.PdfReader(pdf_path)
    │       → pages joined with "--- PAGE BREAK ---"
    │       → truncate at 50,000 chars
    │       → emit meta {partial_text: true} if truncated
    │
    ├─ ollama.show(model) → check tool-call support
    │       → if unsupported: downgrade to offline, emit meta {model_no_tools: true}
    │
    ├─ ReAct loop (up to 30 rounds):
    │   ┌───────────────────────────────────────────┐
    │   │  ollama.chat(tools=[web_search, fetch_url]) │
    │   │      → model returns tool call              │
    │   │      → emit SSE {type:"tool_call", ...}     │
    │   │      → execute tool → inject result         │
    │   │      → repeat until model returns text      │
    │   └───────────────────────────────────────────┘
    │
    └─ Final response: ollama.chat(stream=True) → token SSE stream

SSE events rendered:
    tool_call → transient status line: "→ web_search('Chen 2019...')"
    token     → review message bubble (streaming)
    meta      → warning chips (partial text, no-tools downgrade)
```

### 3.3 SSE Event Envelope

Every event from backend to renderer follows this schema:

```json
{
  "type":    "token" | "tool_call" | "meta" | "error",
  "pane_id": "left" | "right",
  "payload": {
    "text":              "…",           // token only
    "tool":              "web_search",  // tool_call only
    "args":              {"query":"…"}, // tool_call only
    "context_truncated": true,          // meta
    "review_offline":    false,         // meta
    "model_no_tools":    false,         // meta
    "partial_text":      true,          // meta
    "message":           "…",           // error
    "code":              "BACKEND_DOWN" // error
  }
}
```

---

## 4. Component Breakdown

### 4.1 Frontend: `src/ai/`

| Component | Responsibility |
| --- | --- |
| `pane-chat-panel/PaneChatPanel.ts` | Renders message thread, input, shortcut buttons, model badge, web-search toggle. Keyed to `PaneId`. |
| `pane-chat-panel/MessageBubble.ts` | Renders a single message with streaming cursor, tool-call status lines (collapsible), source chips |
| `model-browser/ModelBrowser.ts` | Lists local models, accepts free-text model tag input, shows pull progress, clears session on switch |
| `hooks/useBackend.ts` | IPC wrapper: sends requests to Main, receives `backend:ready` port, manages abort signals |
| `hooks/useSSEStream.ts` | Consumes IPC `ai:stream:{pane_id}` events, routes token/tool_call/meta/error to caller state |
| `types.ts` | `PaneId`, `SSEEvent`, `ChatMessage`, `ModelInfo`, `BackendStatus` — shared across all AI components |

### 4.2 Main Process: `electron/ai-bridge.mjs`

| Responsibility | Detail |
| --- | --- |
| Spawn Python sidecar | `child_process.spawn(pythonBin, ['main.py'], {env: {LEAPREADER_PORT:0, OLLAMA_BIN:…}})` |
| Port negotiation | Poll `{temp}/leapreader-backend.port` every 100 ms; emit `backend:ready:{port}` on success |
| SSE relay | Open `EventSource` to backend; relay each event to renderer via `webContents.send('ai:stream:{pane_id}', event)` |
| Abort relay | IPC `ai:abort:{pane_id}` → DELETE `{backend}/chat/{pane_id}/{session_id}` |
| Cleanup | `app.on('before-quit')` → kill Python sidecar (SIGTERM, then SIGKILL after 3 s) |

### 4.3 Python Sidecar: `backend/`

| Module | Responsibility |
| --- | --- |
| `main.py` | FastAPI app; CORS locked to `localhost`; `/health` endpoint; mounts `chat_router` |
| `chat_router.py` | Routes: `POST /chat`, `POST /summarize`, `POST /review`, `DELETE /chat/{pane_id}/{session_id}`. Holds in-memory `Dict[(pane_id, session_id), List[Message]]` |
| `review_agent.py` | `run_review(pdf_path, pane_id, session_id, offline, stream_callback)` — ReAct loop; synchronous tool turns; streaming final turn |
| `web_tools.py` | `web_search(query) -> List[{title, url, snippet}]` via `ddgs` (formerly `duckduckgo-search`); `fetch_url(url) -> str` via requests + html stripping |
| `ollama_manager.py` | `ensure_ollama()` — PATH check → download if needed → start process → monitor; `ensure_model(tag)` — pull with progress callback |
| `context_utils.py` | `extract_pdf(path) -> (text, truncated_bool)` — pypdf + PAGE BREAK join + 50k char limit; `trim_to_tokens(text, limit) -> (text, truncated_bool)` — char-based token approximation |
| `prompt_loader.py` | `load_review_prompt() -> str` — reads `assets/review-prompt.md` from `extraResources` path; cached after first load |

---

## 5. Key Design Decisions and Trade-offs

### 5.1 Why a Python sidecar, not Node.js calling Ollama directly?

The Ollama Python client (v0.6.2) has first-class support for the `tools` API needed for the ReAct review agent. The `pypdf` and `duckduckgo-search` libraries are Python-native with no Node equivalents of comparable maturity. The proven `manuscript2presentation` codebase is Python. The trade-off is a larger installer and a more complex process model — but the Ollama model download (~2 GB) dwarfs the Python venv (~100–150 MB) in any case.

### 5.2 Why SSE, not WebSocket?

SSE is unidirectional (server → client), which matches the streaming use case exactly. FastAPI has first-class `StreamingResponse` / `EventSourceResponse` support. SSE is easier to abort (HTTP DELETE), easier to test (curl), and requires no handshake. The only downside vs. WebSocket is no client-to-server push mid-stream — but the use case never needs that.

### 5.3 Why random port + temp file negotiation?

Port 8000 or any fixed port is frequently occupied on developer machines. Random port avoids the conflict. Temp file (rather than stdout parsing) is more robust: stdout may carry uvicorn startup logs, and stdout piping in Electron `child_process` is unreliable on Windows if the spawned process writes large amounts of data.

### 5.4 Why `pane_id` in every request rather than two separate backend processes?

Two backend processes would double the Ollama RAM footprint (two model contexts loaded). `pane_id` routing with a single backend and a shared Ollama instance keeps memory proportional to one model load (~1.5–2 GB for 3B Q4).

### 5.5 Why synchronous tool turns, streaming only on the final turn?

Ollama's streaming API returns one token at a time. During the ReAct tool-call phase, the model produces structured JSON (tool name + args), not human-readable text — streaming it token-by-token would be unrenderable in the UI. The tool turns are short (< 200 ms) so synchronous is fine. Only the final review text (hundreds to thousands of tokens) is streamed.

---

## 6. First-Run Experience

On a machine with no prior Ollama installation:

1. **App opens** — PDF reader fully usable immediately.
2. **PaneChatPanel shows:** "Starting AI engine… downloading Ollama (34 MB)"
3. **Ollama downloaded** to `userData/ollama/bin/` — **"Pulling llama3.2:3b (2.0 GB)…"**
4. **Progress** shown as percentage + MB/s in the panel.
5. **Model ready** — panel unlocks, "Ready" badge appears.
6. **Subsequent launches** — Ollama starts in < 3 s; model loads in < 5 s; no download.

On a machine with Ollama already installed (system PATH):
- Steps 2–4 are replaced by "Connecting to local AI engine…" (< 3 s).

---

## 7. Privacy Boundary

| What | Where | When |
| --- | --- | --- |
| PDF text | Stays on device | Always |
| Chat messages | Stays on device | Always |
| LLM inference | `localhost:11434` | Always |
| Ollama binary download | `github.com/ollama/ollama/releases` | First run only |
| Model download | `ollama.com` servers | First run (per model) |
| DuckDuckGo search | `duckduckgo.com` | User-initiated (web toggle or Review) |
| URL fetch (DOI verification) | Publisher / DOI resolver | User-initiated (Review only) |
| Review (offline) | `localhost:11434` | No network calls at all |

---

## 8. Build and Packaging

```
# AI feature branch only
feature/ai-assistant

# Python venv (built at CI time)
uv sync --project backend/ --output-path backend/.venv

# electron-builder extraResources (feature branch package.json only)
{
  "extraResources": [
    { "from": "backend",        "to": "backend" },
    { "from": "backend/.venv",  "to": "backend/.venv" },
    { "from": "assets",         "to": "assets" }
  ]
}

# Electron spawns backend
const pythonBin = path.join(process.resourcesPath, 'backend/.venv/bin/python');
const backendMain = path.join(process.resourcesPath, 'backend/main.py');
child_process.spawn(pythonBin, [backendMain], { env: {...process.env, LEAPREADER_PORT: '0'} });
```

Target platforms: Linux (AppImage + deb), Windows (NSIS x64). macOS is additive — same pattern, `bin/python` path resolves correctly.

---

## 9. Open Items for Implementation Sprints

| Item | Where to decide | Notes |
| --- | --- | --- |
| Context trim strategy (end-only vs. middle-cut) | `context_utils.py` | Spine binds only the limits, not the algorithm |
| DuckDuckGo rate-limit backoff | `web_tools.py` | Exponential backoff or user-visible warning |
| Ollama version pinning strategy | `ollama_manager.py` | Pin specific tag vs. always-latest; trade stability for freshness |
| Chat panel height / drag handle | `pane-chat-panel/` | A13: ~30% default, resizable; exact CSS deferred |
| AI button vs ⋯ FAB layout | `src/reader/` | NOTE FOR PM: UX decision before FR-1 sprint |
| Page-nav pill vs chat drawer overlap | `src/reader/` | NOTE FOR PM: UX decision before FR-1 sprint |
| Model pull progress debounce frequency | `pane-chat-panel/` | Prevent too-frequent re-renders during pull |
