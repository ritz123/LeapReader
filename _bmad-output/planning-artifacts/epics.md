---
stepsCompleted: [step-01, step-02, step-03]
inputDocuments:
  - prds/prd-LeapReader-2026-07-07/prd.md
  - architecture/architecture-LeapReader-2026-07-07/ARCHITECTURE-SPINE.md
  - architecture/architecture-LeapReader-2026-07-07/SOLUTION-DESIGN.md
---

# LeapReader AI Research Assistant — Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for LeapReader AI Research Assistant, decomposing the requirements from the PRD and Architecture into implementable stories.

---

## Requirements Inventory

### Functional Requirements

FR-1: Each pane has an "AI" toggle button in its float layer. Clicking it opens or closes that pane's Pane Chat Panel without affecting the other pane or PDF rendering.
FR-2: Each Pane Chat Panel displays a scrollable conversation thread with alternating user/assistant bubbles; assistant messages stream token-by-token with a loading indicator.
FR-3: User can type a message and submit via Enter or Send button; Shift+Enter inserts newline; Stop generation button aborts streaming.
FR-4: When a message is submitted, the Local Backend uses the Pane Context (pdfjs text, ≤8 000 tokens) from that pane's document only; context badge shows document name.
FR-5: A "Clear" button resets that pane's conversation thread and server-side history only.
FR-6: "Summarize" shortcut submits a structured 4-heading summarization prompt using the pane's pdfjs text layer (up to 8 000-token cap).
FR-7: Summarize output streams into the chat thread labeled "Summary."
FR-8: "Review" shortcut triggers a ReAct agent loop: backend extracts PDF text via pypdf (50 000-char limit, PAGE BREAK markers), runs ollama.chat(tools=[web_search, fetch_url]) for up to 30 tool-call rounds, then streams the final review.
FR-9: Review streams into Pane Chat Panel labeled "Peer Review"; SSE uses tool_call events (transient status lines) and token events (streaming into bubble); tool status collapses when final stream begins.
FR-10: "Search web" toggle in input area; when active, backend calls ddgs before the model and injects top snippets; toggle resets after each submission.
FR-11: Each Grounded Response displays collapsible source chips (title + URL) below the assistant message; URLs open in system browser.
FR-12: Electron main process spawns the Local Backend on launch using the bundled Python environment; backend binds to a random port; terminated when app closes; backend crash → recoverable "AI unavailable" state.
FR-13: Ollama Manager checks PATH for existing ollama binary; if absent, downloads the appropriate binary for OS/arch to userData; starts Ollama and monitors it; progress shown in Pane Chat Panel.
FR-14: After Ollama starts, checks for default model (llama3.2:3b Q4_K_M, ~2 GB); if absent, pulls it with progress shown; user can use PDF reader during download.
FR-15: Model Browser in Pane Chat Panel: lists local models, lets user enter any Ollama model tag and pull it; pull progress shown; switching models clears chat session and persists selection in localStorage.
FR-16: Backend streams tokens from Ollama's streaming chat endpoint to frontend via SSE; first token ≤3 s; Stop generation terminates immediately; no tokens dropped or duplicated.
FR-17: Backend prepends Pane Context to user message, respects model's context limit, trims from end if exceeded; returns context_truncated flag in SSE meta; panel renders visible warning chip.
FR-18: "Ask AI" button on floating selection bar; sends selected text to the Pane Chat Panel of the pane where the text was selected (pane-origin tracked via data-pane-id attribute on #selection-float).
FR-19: "Review (offline)" secondary action on Review button (long-press/dropdown): runs same review without web tools; citations marked "Not verifiable (offline mode)"; works with all models including gemma3:1b.

---

### NonFunctional Requirements

NFR-1: First token latency ≤ 3 seconds on a 4-core CPU laptop with default 3B Q4 model and ≤4 000-token context.
NFR-2: Pane Chat Panel open/close and inference must not block or degrade PDF rendering, page navigation, or annotation in either pane.
NFR-3: Backend startup must not delay app readiness; PDF reader fully functional before backend becomes healthy.
NFR-4: No document text, user messages, or model responses leave the local machine except for: (1) first-run Ollama binary/model downloads; (2) user-initiated DuckDuckGo search and URL fetching via web toggle or Review. Help dialog must enumerate all three network categories.
NFR-5: Help dialog privacy section must accurately describe AI data handling including offline mode.
NFR-6: Backend crashes must not crash the Electron app; both Pane Chat Panels enter a recoverable error state independently.
NFR-7: If Ollama is killed mid-inference, streaming response aborts cleanly; rest of app unaffected.
NFR-8: Ollama binary and model downloads must be resumable; interrupted download does not corrupt local state.
NFR-9: Each Pane Chat Panel is keyboard-navigable; all interactive elements have accessible labels; streaming text announced to screen readers on completion, not token-by-token.
NFR-10: Python backend consumes < 100 MB RAM when idle; model memory is Ollama's responsibility (~1.5–2 GB for 3B Q4).
NFR-11: Bundled uv venv (Python interpreter + dependencies) must not increase the compressed Electron installer size by more than 150 MB.

---

### Additional Requirements

From Architecture Spine (13 ADs):

- **AD-1 (Process boundary):** Renderer communicates with backend exclusively through Electron IPC → Main → HTTP. No direct renderer-to-backend calls.
- **AD-2 (pane_id routing):** Every backend API request carries `pane_id: "left"|"right"`; conversation store keyed `(pane_id, session_id)`; Clear increments session_id only for that pane.
- **AD-3 (SSE envelope):** Five fixed event types: `token`, `tool_call`, `meta`, `error`, `pull_progress`. tool_call args are per-tool typed: `web_search→{query:string}`, `fetch_url→{url:string}`. meta.sources carries source chips for FR-11.
- **AD-4 (Process ownership + crash recovery):** Main owns sidecar (spawn/kill). Sidecar owns Ollama. Crash: emit backend:down, retry 3× with backoff, then backend:failed. Ollama crash: watchdog restarts twice, then SSE error OLLAMA_CRASH.
- **AD-5 (Port negotiation):** Backend writes port to temp file; Main polls every 100 ms up to 10 s; renderer gets port via IPC backend:ready.
- **AD-6 (Context isolation):** Pane Context text never crosses pane boundary; backend rejects requests attempting cross-pane context.
- **AD-7 (Extraction split + body schema):** Chat/Summarize POST body: `{pane_id, session_id, message, context_text, web_search}`. Review POST body: `{pane_id, session_id, file_path, offline}`. Field names are normative.
- **AD-8 (Tool-call capability detection):** Catch `ollama.ResponseError` with "does not support tools" in message; downgrade to offline and emit meta.model_no_tools.
- **AD-9 (Ollama binary path + OLLAMA_PROVENANCE):** OLLAMA_PROVENANCE="path"|"bundled"; kill Ollama on shutdown only if "bundled".
- **AD-10 (Selection pane-origin tagging):** selection listeners set `data-pane-id` on `#selection-float` before showing; "Ask AI" reads this attribute.
- **AD-11 (Review streaming):** Tool-call turns are synchronous (await tool result); final response turn uses `ollama.chat(stream=True)`; tool_call SSE events emitted before final stream.
- **AD-12 (Branch isolation):** All AI code lives on `feature/ai-assistant` branch; main branch build config does not reference AI extraResources.
- **AD-13 (Abort chain):** IPC ai:abort:{pane_id} carries `{session_id}` in payload; Main sends DELETE /chat/{pane_id}/{session_id}; sidecar emits terminal SSE error{ABORTED}; max 1 active stream per pane.
- **Build:** uv venv in extraResources; created at build time via `uv sync`; spawned from venv's Python interpreter. Stack: Python 3.12, FastAPI 0.139.0, uvicorn 0.50.2, ollama 0.6.2, pypdf ≥4.0, ddgs 9.14.4, requests latest, bundled review-prompt.md asset.
- **UX open items (must be resolved before FR-1 implementation):** AI button vs ⋯ FAB layout; page-nav pill vs chat drawer overlap.

---

### UX Design Requirements

No UX design document. Two layout conflicts were resolved by inspecting the existing HTML structure (`index.html`, `pane-float-bottom` flex row):

UX-R1 (AI button placement): Add a small `⊕ AI` icon button between the nav pill (`.pane-float-nav`) and the ⋯ FAB (`.pane-tools-fab`) in the existing `pane-float-bottom` flex row. No corner conflict — slots naturally as a third flex item. IDs: `pane-ai-left` / `pane-ai-right`.

UX-R2 (nav pill vs chat drawer): When chat panel opens, add class `ai-panel-open` to `.canvas-wrap`. CSS: `.canvas-wrap.ai-panel-open .pane-float-layer { bottom: var(--ai-panel-height, 30%); }` — entire float layer shifts up above the drawer; nav pill and FABs remain visible and usable.

---

### FR Coverage Map

| FR | Epic | Summary |
|---|---|---|
| FR-12 | Epic 1 | Backend lifecycle (spawn, port negotiation, kill, crash recovery) |
| FR-13 | Epic 1 | Ollama auto-install and auto-start |
| FR-14 | Epic 1 | Default model auto-pull with progress |
| FR-16 | Epic 1 | SSE streaming delivery |
| FR-17 | Epic 1 | Prompt construction and context trimming |
| FR-1 | Epic 2 | Per-pane AI toggle button |
| FR-2 | Epic 2 | Message thread display |
| FR-3 | Epic 2 | Text input, submit, stop generation |
| FR-4 | Epic 2 | Pane-bound context injection |
| FR-5 | Epic 2 | Clear chat session |
| FR-18 | Epic 2 | "Ask AI" on text selection |
| FR-6 | Epic 3 | Summarize shortcut |
| FR-7 | Epic 3 | Summarize output display |
| FR-8 | Epic 3 | Review ReAct agent |
| FR-9 | Epic 3 | Review output display with tool status |
| FR-19 | Epic 3 | Review offline mode |
| FR-10 | Epic 4 | Web search toggle |
| FR-11 | Epic 4 | Search result source chips |
| FR-15 | Epic 4 | Model Browser |

---

## Epic List

### Epic 1: AI Engine Foundation
Users can see the AI assistant loading with progress feedback, and the PDF reader is fully usable throughout. Python backend, Ollama binary, and default model are automatically installed and started on first launch.
**FRs covered:** FR-12, FR-13, FR-14, FR-16, FR-17
**NFRs addressed:** NFR-1, NFR-3, NFR-4, NFR-5, NFR-6, NFR-7, NFR-8, NFR-10, NFR-11

### Epic 2: Per-Pane Chat Interface
Users can freely chat with any PDF in either pane independently. Each pane has its own AI button, message thread, and context binding. Text selections send directly to the chat via "Ask AI."
**FRs covered:** FR-1, FR-2, FR-3, FR-4, FR-5, FR-18
**UX resolved:** UX-R1 (AI button in pane-float-bottom), UX-R2 (float layer shifts up when panel open)
**NFRs addressed:** NFR-2, NFR-9

### Epic 3: Paper Analysis Shortcuts
Users can get a structured 4-heading summary or a full 7-section peer review with citation verification — all with a single button click. Review automatically searches the web and fetches DOI pages in real time.
**FRs covered:** FR-6, FR-7, FR-8, FR-9, FR-19

### Epic 4: Web Search & Model Management
Users can ground any free-form chat response with live DuckDuckGo results and see source links. Users can browse, pull, and switch any Ollama model from within the app.
**FRs covered:** FR-10, FR-11, FR-15

---

## Epic 1: AI Engine Foundation

Users can see the AI assistant loading with progress feedback while the PDF reader remains fully usable. Python backend, Ollama binary, and default model are automatically installed and started on first launch — the user takes no manual setup steps.

### Story 1.1: Branch Setup and Python Backend Scaffold

As a developer,
I want a dedicated feature branch with the Python backend directory structure and build configuration in place,
So that all subsequent AI stories have a clean, isolated foundation that does not affect the main branch or Android/web builds.

**Acceptance Criteria:**

**Given** the repository is on `main`
**When** the developer creates and checks out `feature/ai-assistant`
**Then** the branch exists in git with no AI code on `main`

**Given** the feature branch is checked out
**When** the developer inspects the project
**Then** the following directories and files exist: `backend/` (with `main.py`, `pyproject.toml`), `electron/ai-bridge.mjs`, `assets/review-prompt.md`
**And** `package.json` on the feature branch includes an `extraResources` entry for `backend/` and `assets/` pointing to the correct packaged paths
**And** `package.json` on `main` has no `extraResources` entries referencing AI assets

**Given** the developer runs `uv sync` in `backend/`
**When** the command completes
**Then** a `.venv/` is created under `backend/` with all dependencies from `pyproject.toml` (FastAPI 0.139.0, uvicorn 0.50.2, ollama 0.6.2, pypdf ≥4.0, ddgs 9.14.4, requests)
**And** `uv run python -c "import fastapi, ollama, pypdf, ddgs"` exits 0

---

### Story 1.2: Python Backend Process Lifecycle

As a developer,
I want the Electron app to spawn the Python FastAPI backend as a child process and communicate its port to the renderer,
So that the PDF reader can show AI panel status and later route AI requests to the backend.

**Acceptance Criteria:**

**Given** the app launches
**When** `electron/ai-bridge.mjs` runs
**Then** it spawns `backend/.venv/bin/python backend/main.py` with env vars `LEAPREADER_PORT=0` and `OLLAMA_BIN`
**And** the backend binds to a random free port and writes it to `{os.tmpdir()}/leapreader-backend.port`

**Given** the backend has written its port to the temp file
**When** `ai-bridge.mjs` polls the file at 100 ms intervals (up to 10 s)
**Then** on successful read it emits IPC `backend:ready:{port}` to all renderer windows

**Given** the Electron window closes
**When** `app.on('before-quit')` fires
**Then** the Python sidecar process is terminated (SIGTERM, then SIGKILL after 3 s)
**And** no zombie Python or Ollama processes remain after app exit

**Given** the backend crashes unexpectedly
**When** `ai-bridge.mjs` detects process exit with non-zero code
**Then** it emits IPC `backend:down` and retries spawn up to 3× with 2 s / 5 s / 10 s backoff
**And** after 3 failures it emits `backend:failed` and stops retrying

**Given** the backend is unavailable (not yet started or crashed)
**When** the user opens the PDF reader
**Then** the PDF reader is fully functional (open files, scroll, zoom, annotate)
**And** both Pane Chat Panels (when they exist) show "AI unavailable" state — not an app crash

---

### Story 1.3: Ollama Auto-Install and Auto-Start

As a user,
I want Ollama to be automatically downloaded and started if it isn't already installed,
So that I don't need to manually install anything to use the AI features.

**Acceptance Criteria:**

**Given** the backend starts on a machine where `ollama` is not on system PATH
**When** `ollama_manager.ensure_ollama()` runs
**Then** it downloads the correct Ollama binary for the OS/arch from `https://github.com/ollama/ollama/releases/latest`
**And** saves it to `{app.userData}/ollama/bin/ollama` (or `.exe` on Windows)
**And** sets `OLLAMA_PROVENANCE = "bundled"`

**Given** the backend starts on a machine where `ollama` is on system PATH
**When** `ollama_manager.ensure_ollama()` runs
**Then** it uses the system binary without downloading
**And** sets `OLLAMA_PROVENANCE = "path"`

**Given** Ollama binary is resolved
**When** `ollama_manager` starts the Ollama process
**Then** Ollama is running and responding on `localhost:11434` within 10 s
**And** it is started with env vars `OLLAMA_NUM_PARALLEL=1` and `OLLAMA_MAX_LOADED_MODELS=1`

**Given** Ollama crashes mid-session
**When** the `ollama_manager` watchdog detects the process exit
**Then** it restarts Ollama once immediately, then once after 5 s on a second failure
**And** after 2 consecutive failures it emits SSE `error {code:"OLLAMA_CRASH"}` to any active stream

**Given** the app quits and `OLLAMA_PROVENANCE == "bundled"`
**When** the sidecar shuts down
**Then** the Ollama process is killed

**Given** the app quits and `OLLAMA_PROVENANCE == "path"`
**When** the sidecar shuts down
**Then** the system Ollama process is left running (not killed)

---

### Story 1.4: Default Model Auto-Pull with Progress

As a user,
I want the default AI model to be downloaded automatically on first launch with visible progress,
So that I can see what's happening and continue using the PDF reader while it downloads.

**Acceptance Criteria:**

**Given** Ollama is running and `llama3.2:3b` (Q4_K_M) is not present locally
**When** `ollama_manager.ensure_model("llama3.2:3b")` runs
**Then** it initiates a model pull and emits SSE `pull_progress` events at each progress update:
`{type:"pull_progress", pane_id:"left", payload:{model:"llama3.2:3b", percent:N, speed_mbps:M, eta_s:K}}`

**Given** pull_progress SSE events are flowing from the backend
**When** `ai-bridge.mjs` receives them
**Then** it relays them via IPC `backend:pull_progress` to all renderer windows

**Given** the model pull is in progress
**When** the user interacts with the PDF reader (scroll, zoom, open file)
**Then** PDF reading is unaffected — the pull is fully non-blocking

**Given** the model pull completes successfully
**When** the pull finishes
**Then** the Pane Chat Panel status updates from "Pulling model…" to "Ready"
**And** `ollama.list()` returns a model entry matching `llama3.2:3b`

**Given** the app is closed mid-pull
**When** the app is reopened
**Then** the pull resumes or restarts cleanly — no corrupt model state

---

### Story 1.5: Streaming Infrastructure, Context Trimming, and Privacy Help Text

As a developer,
I want the core SSE streaming pipeline and context-trimming utilities in place, and the Help dialog updated with accurate privacy information,
So that all subsequent chat and shortcut stories can use a tested, spec-compliant streaming foundation.

**Acceptance Criteria:**

**Given** a POST `/chat` request arrives at `chat_router.py` with `{pane_id, session_id, message, context_text, web_search: false}`
**When** `ollama.chat(stream=True)` is called
**Then** the backend emits a sequence of SSE `token` events: `{type:"token", pane_id:…, payload:{text:"…"}}`
**And** terminates with a SSE `meta` event: `{type:"meta", pane_id:…, payload:{context_truncated: bool}}`

**Given** `context_text` contains text longer than the model's 8 000-token cap
**When** `context_utils.trim_to_tokens(text, 8000)` is called
**Then** text is trimmed from the end and the returned `truncated` flag is `true`
**And** the subsequent SSE `meta` event carries `context_truncated: true`

**Given** an SSE `error` event is emitted with `code:"ABORTED"`
**When** the renderer receives it via IPC `ai:stream:{pane_id}`
**Then** it treats it as a clean stop (no error UI shown, generation indicator cleared)

**Given** the user opens the Help dialog (☰ → Help)
**When** the Privacy section renders
**Then** it accurately describes three network categories: (1) always-local Ollama inference; (2) first-run Ollama binary and model downloads; (3) user-initiated web search and URL fetching
**And** it explains how to use Review in offline mode to avoid network calls

---

## Epic 2: Per-Pane Chat Interface

Users can freely chat with any PDF open in either pane independently. Each pane has its own AI toggle, message thread, and document context binding. Text selections can be sent directly to the chat.

### Story 2.1: AI Panel Toggle Button and Chat Panel Shell

As a user,
I want an AI toggle button in each pane's toolbar and a collapsible chat panel at the bottom of each pane,
So that I can open the AI assistant exactly where I'm reading without it intruding when I don't need it.

**Acceptance Criteria:**

**Given** the app is open with any document or no document
**When** the user looks at `pane-float-bottom` in either pane
**Then** an "AI" button (`id="pane-ai-left"` / `id="pane-ai-right"`) appears between the nav pill and the ⋯ FAB (UX-R1)

**Given** the user clicks the AI button
**When** the Pane Chat Panel opens
**Then** a drawer appears anchored at the bottom of that pane's `canvas-wrap` at ~30% pane height
**And** the `canvas-wrap` gains class `ai-panel-open`
**And** CSS `.canvas-wrap.ai-panel-open .pane-float-layer { bottom: var(--ai-panel-height, 30%); }` shifts the float layer up so the nav pill and FABs are fully visible above the drawer (UX-R2)

**Given** the left pane chat is open
**When** the user clicks the right pane's AI button
**Then** the right pane chat opens independently — the left pane chat is unaffected

**Given** the chat panel is open or closed
**When** the user scrolls, zooms, or annotates the PDF
**Then** PDF interaction is fully unaffected (NFR-2)

**Given** the app is reopened after a session where the left panel was open
**When** the renderer reads `localStorage`
**Then** it restores the panel state from `leapReaderAIPanelLeft` / `leapReaderAIPanelRight`

---

### Story 2.2: Message Thread and SSE Token Rendering

As a user,
I want to see a conversation thread in the chat panel with streaming responses,
So that I can follow the AI's answer as it's being generated.

**Acceptance Criteria:**

**Given** the chat panel is open and a response is in progress
**When** SSE `token` events arrive via IPC `ai:stream:{pane_id}`
**Then** each token is appended to the current assistant message bubble in real time
**And** the panel auto-scrolls to keep the latest token in view

**Given** an assistant message is streaming
**When** the first token arrives
**Then** it appears within 3 seconds of the request being sent (NFR-1)

**Given** a backend error occurs during streaming
**When** an SSE `error` event arrives
**Then** the error is rendered as a visually distinct error bubble with the `payload.message` text and a "Retry" button
**And** the retry button re-submits the same request

**Given** streaming completes
**When** the `meta` event with `context_truncated: true` arrives
**Then** a visible warning chip "Partial document used" appears below the assistant bubble

---

### Story 2.3: Text Input, Submit, and Abort

As a user,
I want to type messages and stop generation mid-stream,
So that I have full control over each chat interaction.

**Acceptance Criteria:**

**Given** the chat panel is open and no response is streaming
**When** the user types a message and presses Enter
**Then** the message is submitted and appears as a user bubble in the thread
**And** the Send button is replaced by a "Stop" button during generation

**Given** a response is streaming
**When** the user clicks "Stop"
**Then** the renderer sends IPC `ai:abort:{pane_id}` with payload `{session_id}` to Main
**And** Main sends `DELETE /chat/{pane_id}/{session_id}` to the backend
**And** the backend cancels the asyncio task and emits a final SSE `error {code:"ABORTED"}`
**And** the renderer receives ABORTED and shows no error state — generation simply stops

**Given** the input field is focused
**When** the user presses Shift+Enter
**Then** a newline is inserted (no submit)

**Given** a response is currently streaming
**When** the user attempts to submit a new message
**Then** the Send button remains disabled and the new message cannot be submitted until generation completes or is aborted (one active stream per pane)

---

### Story 2.4: Pane-Bound Context Injection

As a user,
I want the AI to answer questions about the specific document I'm reading in each pane,
So that the left chat always refers to the left document and the right chat always refers to the right document.

**Acceptance Criteria:**

**Given** the user submits a message in the left pane's chat
**When** `chat_router.py` receives the request
**Then** the request body contains `{pane_id:"left", session_id, message, context_text}` where `context_text` is the left pane's pdfjs-extracted text (up to 8 000-token cap)
**And** the right pane's document text is never included in the left pane's request

**Given** a document is loaded in the pane
**When** the chat panel header renders
**Then** it shows a document badge: `"paper.pdf"` (or the current file's name)
**And** if no document is loaded the badge reads "No document" and the Summarize/Review buttons are disabled

**Given** the user loads a new document into a pane while a chat session is open
**When** the new document finishes loading
**Then** the badge updates immediately to the new document name
**And** a banner appears: "Document changed — clear chat to use the new document as context"

---

### Story 2.5: Clear Chat Session

As a user,
I want to clear a pane's chat history,
So that I can start a fresh conversation without the previous context influencing the AI.

**Acceptance Criteria:**

**Given** the chat panel has one or more messages
**When** the user clicks "Clear"
**Then** the message thread is emptied in that pane only — the other pane's thread is unaffected
**And** a "Chat cleared" toast appears briefly

**Given** Clear is clicked
**When** the next message is submitted
**Then** it carries a new `session_id` (UUID v4 generated client-side)
**And** the backend has no conversation history for the previous session — it starts fresh

---

### Story 2.6: "Ask AI" from Text Selection

As a user,
I want to select text in a document and send it to the AI with a tap,
So that I can instantly look up terms or ask about passages without typing.

**Acceptance Criteria:**

**Given** the user selects text in the left pane
**When** the `selectionchange` event fires in the left pane's listener
**Then** `#selection-float.dataset.paneId` is set to `"left"` before the floating bar is shown

**Given** the floating bar is visible and the user clicks "Ask AI"
**When** the handler reads `#selection-float.dataset.paneId`
**Then** the left pane's Pane Chat Panel opens (if not already open)
**And** the input is pre-filled with `"Explain: {selected text}"` and auto-submitted
**And** the right pane's chat is not affected

**Given** the same interaction in the right pane
**When** the user clicks "Ask AI" on a right-pane selection
**Then** only the right pane's chat is used — the correct pane is always routed

---

## Epic 3: Paper Analysis Shortcuts

Users can get a structured summary or a full peer review of any loaded paper with a single button click. Review automatically searches the web and fetches DOI pages in real time to verify citations.

### Story 3.1: Summarize Shortcut

As a user,
I want to click "Summarize" and get a structured 4-heading summary of my paper in under 45 seconds,
So that I can quickly decide whether a paper is worth reading in full.

**Acceptance Criteria:**

**Given** a PDF with extractable text is loaded in a pane
**When** the user clicks "Summarize" in that pane's chat panel
**Then** the request is sent as `POST /summarize {pane_id, session_id, message:"", context_text, web_search:false}`
**And** the backend sends the structured summarization prompt with the pdfjs text as context
**And** the output streams into the chat thread labeled "Summary" (visually distinct from free-form bubbles)

**Given** the summary is complete
**When** the full response has arrived
**Then** the output contains all four headings: **Problem**, **Method**, **Key Results**, **Limitations**

**Given** a 20-page PDF on a 4-core CPU laptop with the default 3B Q4 model
**When** the user clicks Summarize
**Then** the complete response finishes within 45 seconds wall-clock (SM-2)

**Given** no document is loaded in the pane
**When** the user inspects the Summarize button
**Then** it is disabled with tooltip "Open a document to summarize"

---

### Story 3.2: Review Backend — PDF Extraction and ReAct Agent

As a developer,
I want the backend to extract a paper's full text and run a multi-round ReAct agent loop with web tools,
So that the Review feature can autonomously verify citations and produce a thorough academic review.

**Acceptance Criteria:**

**Given** a `POST /review {pane_id, session_id, file_path, offline:false}` arrives
**When** `context_utils.extract_pdf(file_path)` runs
**Then** it reads all pages via `pypdf.PdfReader`, joins them with `--- PAGE BREAK ---` separators, and truncates at 50 000 characters
**And** returns `(text, truncated: bool)` — if truncated, the backend emits SSE `meta {partial_text: true}`

**Given** the review agent starts with `offline=false`
**When** `review_agent.run_review()` invokes `ollama.chat(tools=[web_search, fetch_url])`
**Then** if the model raises `ollama.ResponseError` with "does not support tools" in the message, the backend automatically downgrades to offline mode and emits SSE `meta {model_no_tools: true}`

**Given** the model calls `web_search(query: string)`
**When** `web_tools.web_search()` executes
**Then** it calls `ddgs` (package `ddgs`, not `duckduckgo-search`) and returns `[{title, url, snippet}]`
**And** the backend emits SSE `{type:"tool_call", payload:{tool:"web_search", args:{query:"…"}}}`

**Given** the model calls `fetch_url(url: string)`
**When** `web_tools.fetch_url()` executes
**Then** it fetches the URL with `requests`, strips HTML, and returns plain text
**And** the backend emits SSE `{type:"tool_call", payload:{tool:"fetch_url", args:{url:"…"}}}`

**Given** the tool-calling phase completes (up to 30 rounds)
**When** the model produces its final response
**Then** `ollama.chat(stream=True)` is used for the final turn only — tokens stream as SSE `token` events (AD-11)

**Given** the review system prompt is loaded
**When** `prompt_loader.load_review_prompt()` is called
**Then** it reads `assets/review-prompt.md` from the `extraResources` path
**And** the prompt instructs the model to produce all 7 sections: Summary, Strengths, Detailed Review (8 subsections), Gaps, Suggestions, Citation Suggestions, Overall Assessment (with Confidence Level)

---

### Story 3.3: Review Frontend — Tool Status and Streaming Output

As a user,
I want to see each citation check happening in real time and then read the review as it streams in,
So that I can follow the agent's reasoning and trust the review output.

**Acceptance Criteria:**

**Given** a Review is in progress
**When** SSE `tool_call` events arrive
**Then** each is rendered as a transient status line in the chat panel: `→ web_search("Chen 2019 attention ICLR")`
**And** multiple tool calls stack as sequential status lines while the agent is running

**Given** the model begins its final response
**When** the first SSE `token` event arrives
**Then** the tool-call status lines collapse (or are visually demoted) and the review text begins streaming into a "Peer Review" labeled bubble

**Given** the review completes
**When** the full response is rendered
**Then** the output contains all 7 top-level sections (Summary through Overall Assessment)
**And** the Overall Assessment includes a numeric score, a Confidence Level (High / Medium / Low), and a recommendation (Accept / Major Revision / Reject)

**Given** `meta {partial_text: true}` is received
**When** it renders
**Then** a warning chip "Partial document used (first 50 000 characters)" appears above the review bubble

**Given** `meta {model_no_tools: true}` is received
**When** it renders
**Then** a warning banner "Model does not support web tools — offline review mode used" appears

**Given** the "Search web" toggle is active in the input area
**When** the user clicks Review (not the toggle-driven path)
**Then** the toggle has no effect — the Review agent always controls its own web-tool invocation

---

### Story 3.4: Review Offline Mode

As a user,
I want to run a review without internet access,
So that I can get AI feedback on a paper even when I'm offline or when I don't want any network calls.

**Acceptance Criteria:**

**Given** the Review button is visible in the chat panel
**When** the user long-presses or clicks the dropdown arrow on the Review button
**Then** a secondary option "Review (offline)" appears

**Given** the user selects "Review (offline)"
**When** the backend receives `POST /review {…, offline:true}`
**Then** no `web_search` or `fetch_url` tools are provided to the model
**And** no outbound network calls are made during the review
**And** the output header carries a visible label "Offline Review (citations not web-verified)"

**Given** the review runs in offline mode
**When** the model encounters a citation
**Then** it marks it "Not verifiable (offline mode)" in the Citations subsection

**Given** a model that does not support tool-calling (e.g. `gemma3:1b`) is active
**When** the user clicks standard Review
**Then** the backend automatically falls back to offline mode (as if `offline:true` was passed)
**And** "Review (offline)" is also directly selectable by the user regardless of model

---

## Epic 4: Web Search & Model Management

Users can ground any free-form chat response with live web results, see clickable source attribution, and switch to any Ollama model from within the app.

### Story 4.1: Web Search Toggle and Grounded Response

As a user,
I want to optionally search the web before asking the AI a question,
So that I get answers grounded in current information rather than just the model's training data.

**Acceptance Criteria:**

**Given** the chat panel is open
**When** the user looks at the input area
**Then** a "Search web" toggle is visible (off by default)

**Given** the toggle is on and the user submits a message
**When** `chat_router.py` processes the request (`web_search: true`)
**Then** it calls `web_tools.web_search(message)` using the `ddgs` library
**And** injects the top 3–5 result snippets into the prompt as context
**And** emits SSE `meta {sources:[{title, url}, …]}` before the first token
**And** the toggle resets to off after submission

**Given** the web search call fails (no internet, timeout, rate limit)
**When** the error is caught
**Then** the model answers from weights only
**And** an inline warning "Web search unavailable — answering from model knowledge" appears in the chat

---

### Story 4.2: Source Attribution Chips

As a user,
I want to see where the AI's grounded information came from,
So that I can verify sources and explore them further.

**Acceptance Criteria:**

**Given** a grounded response arrives with SSE `meta {sources:[…]}`
**When** the renderer processes the meta event
**Then** collapsible source chips (title + URL) are rendered below the assistant message bubble

**Given** a source chip is visible
**When** the user clicks it
**Then** the URL opens in the system default browser (Electron `shell.openExternal`)

**Given** a response has no web search (toggle was off)
**When** the response completes
**Then** no source chips are shown

---

### Story 4.3: Model Browser — List and Switch Models

As a user,
I want to see which models I have locally and switch between them,
So that I can choose the right model for my task without leaving the app.

**Acceptance Criteria:**

**Given** the user opens the "Change model" control in the chat panel
**When** the Model Browser renders
**Then** it lists all models returned by `GET /api/tags` (Ollama local models endpoint)
**And** the currently active model is marked

**Given** the user selects a different locally available model
**When** they confirm the switch
**Then** the chat session is cleared (session_id reset) for that pane
**And** the new model tag is persisted in `localStorage` under `leapReaderActiveModel`
**And** the panel header model badge updates

**Given** the user switches models and the new model does not support tool-calling
**When** the user next clicks Review
**Then** the backend detects `ollama.ResponseError` ("does not support tools") and auto-downgrades to offline review (AD-8)

---

### Story 4.4: Model Browser — Pull New Model

As a user,
I want to pull any Ollama model by name from within the app,
So that I can experiment with different models without using the command line.

**Acceptance Criteria:**

**Given** the user enters a valid model tag (e.g. `qwen3.5:2b`, `gemma3:1b`) in the Model Browser input
**When** they click "Pull"
**Then** the backend initiates a pull and streams `pull_progress` SSE events: `{type:"pull_progress", payload:{model, percent, speed_mbps, eta_s}}`
**And** the Model Browser shows a progress bar for the pull in progress

**Given** the pull is in progress
**When** the user uses the existing active model for chat
**Then** the existing model remains active and fully usable — no interruption

**Given** the pull completes
**When** it finishes
**Then** the new model appears in the model list
**And** it is NOT automatically activated — user must explicitly switch

**Given** the user enters an invalid or non-existent model tag
**When** the pull fails
**Then** an inline error message appears: "Model not found in Ollama registry"
**And** the previously active model is unaffected
