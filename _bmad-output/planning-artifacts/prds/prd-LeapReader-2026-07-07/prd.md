---
title: LeapReader LLM Integration — AI Research Assistant
status: final
created: 2026-07-07
updated: 2026-07-07
---

# PRD: LeapReader — AI Research Assistant (Local LLM Integration)

## 0. Document Purpose

This PRD is for the developer (Biplab Sarkar) and any future contributors. It specifies the requirements for adding a local, privacy-preserving AI research assistant to LeapReader — the split-pane PDF reader. It describes what to build and why; architectural how-to lives in a downstream architecture document. Features are grouped by capability with FRs numbered globally (FR-1 through FR-N) for stable cross-reference. `[ASSUMPTION]` tags mark inferred decisions not directly confirmed by the user; all are indexed in §11.

---

## 1. Vision

LeapReader already makes reading technical documents faster by letting users hold two documents open simultaneously. The next leap is bringing intelligence directly into that reading session — an AI assistant that can summarize a dense paper in seconds, critique it as a peer reviewer would, and look up supporting context from the web, all without the document ever leaving the user's machine.

The assistant runs entirely locally. A Python backend process spawns alongside the Electron app, manages its own Ollama installation and lifecycle, and routes LLM requests to a quantized Llama model running on CPU. No subscription, no API key, no cloud upload, and — crucially — no manual setup by the user beyond installing the LeapReader app itself. Ollama is downloaded and started automatically the first time AI features are used.

Each PDF pane gets its own chat panel anchored at the bottom of that pane's canvas area. The left pane chat talks to the left document; the right pane chat talks to the right document. In split view, both are independently usable. In single-pane view, only the active pane's chat is visible. Users who never open a chat panel lose nothing. Those who do get a tireless research collaborator sitting directly beside the paper they are reading.

---

## 2. Target User

### 2.1 Jobs To Be Done

- **Get the gist fast** — I need to decide in 60 seconds whether a 40-page paper is relevant to my work.
- **Understand deeply** — I want a structured breakdown of a paper's method, claims, and gaps so I can engage with it critically.
- **Cross-reference quickly** — I want to look up a concept or prior work mentioned in the paper without switching out of the reader.
- **Stay private** — I do not want my research documents sent to a third-party cloud service.
- **Work offline** — I need AI assistance even without an internet connection (except when explicitly requesting web search).
- **Keep reading** — I do not want the AI chat to crowd out the document I am reading.
- **Use any model** — I want to experiment with different locally available LLM models without leaving the app.

### 2.2 Non-Users (v1)

- **Android users**: Pane Chat Panels require Ollama and a Python runtime — not viable on Android in v1. The Android build is unchanged.
- **Web app users**: The browser-hosted build does not expose Pane Chat Panels.
- **Teams sharing a network Ollama instance**: Collaborative or server-hosted LLM setups are out of scope.

### 2.3 Key User Journeys

**UJ-1. Riya skims a new paper before her reading group.**
Riya, a PhD student, opens a PDF in LeapReader's left pane. She taps the AI button at the bottom of the left pane to open that pane's chat panel. She clicks the "Summarize" shortcut button. Within 45 seconds, streaming text fills the panel: Problem, Method, Key Results, Limitations. She decides the paper is worth reading in full and collapses the chat panel to return to full reading. *Edge case:* if the PDF has no extractable text layer (scanned image), the app shows a clear error and suggests using a searchable PDF.

**UJ-2. Marcus reviews a paper for a journal submission.**
Marcus loads a paper into the left pane. He opens that pane's chat panel and clicks "Review." The Pane Chat Panel immediately shows tool-call status lines ticking by: `→ web_search("Chen 2019 transformer attention ICLR")`, `→ fetch_url("https://doi.org/10.1234/x")` — the model is verifying citations in real time as it reasons. After 30–90 seconds, the model's final review streams in: seven structured sections — Summary; Strengths; Detailed Review (8 subsections: Technical Correctness, Consistency, Clarity, Research Integrity, Citations, Authenticity, Novelty, Fit for Venue); Gaps; Suggestions; Citation Suggestions; and Overall Assessment (numeric score, Confidence Level, and Accept / Major Revision / Reject recommendation). Each citation it checked is explicitly marked "Verified online," "Partially verified," or "Not verifiable online." He spots a "Bibliographic mismatch" note on one reference — confirming a suspicion he had while reading. He copies the review and pastes it into his submission form. *Edge case:* if the paper is very long, the backend uses the first 50 000 characters and shows a "Partial text used" warning.

**UJ-3. Laila looks up a cited technique mid-read.**
Laila is reading a methods section and encounters "sparse attention mechanism." She selects the phrase, taps "Ask AI" on the floating bar, and the left pane's chat panel opens with "Explain: sparse attention mechanism" pre-filled and submitted. The model answers; she then enables "Search web" and resubmits for grounded results with citations. *Edge case:* web search fails silently → model answers from weights only, with a warning note.

**UJ-4. Arjun opens two papers side-by-side and chats with both independently.**
Arjun, a researcher, loads Paper A in the left pane and Paper B in the right pane. He opens the chat panel on the left pane and asks "What problem does this paper solve?" — gets an answer about Paper A. He then opens the right pane's chat and asks the same question — gets a separate answer about Paper B. Each chat thread is fully independent. *Edge case:* if he swaps the document in a pane mid-conversation, a banner prompts him to clear the chat so the new document context takes effect.

---

## 3. Glossary

- **Pane Chat Panel** — The per-pane collapsible chat interface anchored at the bottom of each pane's canvas area. Contains a message thread, input field, Summarize and Review shortcut buttons, web search toggle, and model status. Each pane has exactly one Pane Chat Panel.
- **Chat Session** — A single conversation thread associated with one Pane Chat Panel and its pane's document. Not persisted across app restarts in v1. `[ASSUMPTION A7]`
- **Pane Context** — The extracted text from the document loaded in a given pane, injected as context for that pane's chat. Each Pane Chat Panel uses only the context from its own pane.
- **Grounded Response** — An LLM response that includes web search results injected into the prompt as supporting evidence.
- **Local Backend** — The Python process (FastAPI server) spawned by the Electron main process on app launch. Manages Ollama installation, Ollama process lifecycle, prompt construction, context trimming, web search, and streaming.
- **Model** — A quantized LLM model pulled from Ollama's registry and stored locally (e.g. `llama3.2:3b` at Q4_K_M quantization).
- **Ollama** — The local LLM runtime, downloaded and managed automatically by the Local Backend. Exposes a REST API on `localhost:11434`.
- **Ollama Manager** — The component of the Local Backend responsible for detecting, downloading, and starting the Ollama binary; pulling Models; and monitoring the Ollama process.
- **Model Browser** — The UI section within the Pane Chat Panel (or a dedicated dialog) where the user can search, pull, and switch between any available Ollama model.
- **Page Extraction** — The process of reading text from a pane's loaded PDF. For chat context (FR-4), text is read from the frontend pdfjs text layer. For the Review shortcut (FR-8), the Local Backend re-extracts text directly from the PDF file using `pypdf` for higher fidelity and larger character limits.
- **ReAct Agent Loop** — A multi-turn Ollama chat loop where the model is given callable tools (`web_search`, `fetch_url`) and autonomously decides when to invoke them, interleaving tool calls with reasoning until it produces a final response.
- **Shortcut Button** — A quick-action button in the Pane Chat Panel (Summarize, Review) that pre-fills and submits a structured prompt template without the user typing.
- **Streaming** — Token-by-token delivery of the model's response to the UI, rendering text as it is generated.
- **Web Search** — A DuckDuckGo search query dispatched by the Local Backend via the `ddgs` Python library (no API key; formerly `duckduckgo-search`, now renamed). Used in two ways: (1) as a toggle in free-form chat, injecting top result snippets into the prompt; (2) as a callable tool (`web_search`) inside the Review ReAct Agent Loop, where the model invokes it autonomously.

---

## 4. Features

### 4.1 Pane Chat Panel — Per-Pane Chat Interface

**Description:** Each pane (left and right) gains its own Pane Chat Panel — a collapsible drawer anchored at the bottom of that pane's canvas, within the pane's visual boundaries. The panel is toggled via an "AI" button added to each pane's existing float layer (alongside the existing ⋯ button). In split view, both pane panels are independently openable. In single-pane view, only the active pane's panel is visible. Each Pane Chat Panel is permanently bound to its own pane's document; there is no shared or cross-pane context. On Android and web builds, the AI button is absent. Realizes UJ-1, UJ-2, UJ-3, UJ-4.

`[NOTE FOR PM: Two layout conflicts require UX resolution before implementation: (1) The "AI" button and the existing ⋯ FAB both target the bottom-right of the float layer — the UX design must assign one of them a different corner or combine them. (2) The existing page-navigation pill sits bottom-center of each pane; the bottom-anchored Pane Chat Panel drawer will overlap it when open — the design must specify how the nav pill repositions or hides when the chat drawer is open.]`

**Functional Requirements:**

#### FR-1: Per-pane AI panel toggle

Each pane has an "AI" toggle button in its float layer. Clicking it opens or closes that pane's Pane Chat Panel without affecting the other pane or the PDF rendering.

**Consequences (testable):**
- Opening the left pane's chat does not open or affect the right pane's chat, and vice versa.
- The PDF in the pane remains fully interactive (scrollable, zoomable) while its chat panel is open.
- The open/closed state of each panel persists in `localStorage` under `leapReaderAIPanelLeft` and `leapReaderAIPanelRight`.
- In single-pane mode, only the active pane's AI button is visible and functional.

#### FR-2: Message thread display

Each Pane Chat Panel displays a scrollable conversation thread with alternating user and assistant message bubbles. Each assistant message streams token-by-token. A loading indicator appears during inference. Realizes UJ-1.

**Consequences (testable):**
- First token of an assistant message appears within 3 seconds of submission on a mid-range CPU.
- The panel auto-scrolls as new tokens arrive.
- Errors (model not running, backend unreachable) render as a distinct error bubble with a short explanation and a retry button.

#### FR-3: Text input and submission

The user can type a message in the panel's input field and submit via Enter or the Send button. Shift+Enter inserts a newline.

**Consequences (testable):**
- Enter submits; Shift+Enter inserts a newline.
- The Send button is disabled while a response is streaming.
- A "Stop generation" button replaces Send during streaming; clicking it aborts the in-progress response.

#### FR-4: Pane-bound context injection

When the user submits a message in a Pane Chat Panel, the Local Backend automatically uses the Pane Context from that same pane's document. The context source is fixed — it does not change based on which pane is "focused." A small document badge in the panel header shows the document name in context (e.g. "paper.pdf").

**Consequences (testable):**
- The left pane's chat always uses the left pane's document as context; the right pane's chat always uses the right pane's document.
- The context badge updates immediately when a new document is loaded into the pane (even mid-session).
- If the pane has no document, the Summarize and Review shortcut buttons are disabled and the badge reads "No document."
- If the document in a pane changes mid-session, a banner prompts: "Document changed — clear chat to use the new document as context."
- Pane Context is capped at ~8 000 tokens; text from the end of the document is trimmed when the limit is exceeded. `[ASSUMPTION A6a]`

#### FR-5: Clear chat session

A "Clear" button in each Pane Chat Panel resets that panel's conversation thread and its server-side conversation history.

**Consequences (testable):**
- Clear affects only that pane's thread; the other pane's thread is unaffected.
- A brief "Chat cleared" toast appears.
- After clearing, new messages start a fresh conversation context on the backend.

---

### 4.2 Summarize Shortcut

**Description:** A "Summarize" shortcut button in each Pane Chat Panel that pre-fills and submits a structured summarization prompt using that pane's document as context. Output covers Problem, Method, Key Results, and Limitations. Realizes UJ-1.

**Functional Requirements:**

#### FR-6: Summarize shortcut submission

The user clicks Summarize; the system uses the pane's already-extracted pdfjs text layer (Pane Context, same as free-form chat — up to 8 000-token cap) and submits:

> You are a scientific paper summarizer. Given the paper text provided, write a concise structured summary with these headings: **Problem**, **Method**, **Key Results**, **Limitations**. Be precise and use the paper's own terminology.

**Consequences (testable):**
- Output always contains the four headings.
- No user typing is required; clicking Summarize is sufficient.
- The button is disabled with tooltip "Open a document to summarize" when no document is loaded in that pane.

#### FR-7: Summarize output display

The summary streams into the chat thread labeled "Summary."

**Consequences (testable):**
- Streams token-by-token.
- Visually distinct label from free-form chat messages.

---

### 4.3 Review Shortcut

**Description:** A "Review" shortcut button that triggers a full ReAct agent loop — the model receives the paper text and two callable tools (`web_search` and `fetch_url`) and autonomously decides when and what to search while writing the review. The model verifies citations by searching DuckDuckGo and fetching DOI pages on its own, in real time, interleaved with its reasoning. This mirrors the proven architecture in the companion `manuscript2presentation` Python project. The output follows a rigorous 7-section academic review structure. Realizes UJ-2.

**Functional Requirements:**

#### FR-8: Review ReAct agent submission

The user clicks Review. The backend:
1. Receives the PDF file path from Electron (via IPC) and extracts the document text using `pypdf.PdfReader` — backend-side extraction is used for Review because it gives higher fidelity and supports up to 50 000 characters without depending on the frontend's already-rendered text layer.
2. Starts a ReAct agent loop using the `ollama` Python library with `tools` enabled, providing two tools to the model:
   - `web_search(query)` — queries DuckDuckGo via the `duckduckgo-search` library; returns title, URL, and snippet for top results.
   - `fetch_url(url)` — fetches and strips HTML from a URL (e.g. a DOI link or publisher page) via `requests`; useful for verifying DOI records and reading abstracts.
3. Uses the bundled review system prompt (shipped as an asset; adapted from `ai-dm-paper-review/SKILL.md`) which specifies **7 top-level sections**:
   - **§1 Summary** — brief restatement of the paper's contribution
   - **§2 Strengths** — what the paper does well
   - **§3 Detailed Review** — 8 subsections: Technical Correctness, Consistency, Clarity, Research Integrity, Citations (model must verify each with `web_search` + `fetch_url`), Authenticity, Novelty, Fit for Venue
   - **§4 Gaps** — missing experiments, unaddressed limitations
   - **§5 Suggestions** — concrete improvements
   - **§6 Citation Suggestions** — references the model found that should be cited but are missing
   - **§7 Overall Assessment** — numeric score and Accept / Major Revision / Reject recommendation
4. The model reasons freely — calling tools whenever it needs to verify a citation, look up an author, or check a DOI — for up to 30 tool-call rounds before producing the final review text.

**Implementation notes:**
- **Streaming adaptation required**: The reference `_run_review_agent` in `manuscript2presentation` uses `ollama.chat()` (blocking, non-streaming). To satisfy FR-16/FR-9's token-by-token streaming requirement, the backend must switch to `ollama.chat(stream=True)` for the model's final response turn, while the tool-call turns remain synchronous (tool results are awaited before continuing the loop). This is an adaptation, not a direct port.
- **Page-break markers**: `pypdf`-extracted text should join pages with `--- PAGE BREAK ---` separators (matching the companion project's convention) to improve model orientation in long documents.
- **Offline mode**: A "Review (offline)" option in the shortcut button long-press or dropdown runs the same prompt without web tools, mirroring the `--no-web` flag in the companion project. `[ASSUMPTION A12]`

**Consequences (testable):**
- The review output contains all 7 top-level sections: Summary, Strengths, Detailed Review (with its 8 subsections), Gaps, Suggestions, Citation Suggestions, and Overall Assessment.
- The Overall Assessment section includes a numeric score, a Confidence Level (High / Medium / Low), and a recommendation (Accept / Major Revision / Reject).
- Each tool call the model makes is visible in the Pane Chat Panel as a status line (e.g. `→ web_search("Smith 2020 attention NeurIPS")`).
- The model's final response streams token-by-token once tool-calling is complete.
- Button is disabled when no document is loaded in the pane.
- For documents over 50 000 characters, the backend uses the first 50 000 characters and shows a visible warning.
- If Ollama's tool-calling API is not supported by the active model, the backend falls back to a non-tool review prompt and shows a warning banner.

#### FR-19: Review offline mode

A secondary action on the Review button — accessible via long-press or dropdown arrow — runs the full review pipeline **without** web tools (`web_search` and `fetch_url` are not provided to the model). The model receives only the paper text and the system prompt. This mirrors the `--no-web` flag from the companion `manuscript2presentation` project. `[ASSUMPTION A12]`

**Consequences (testable):**
- The "Review (offline)" option is reachable without typing; the button shows a dropdown or long-press affordance.
- When Review (offline) is selected, no network calls are made during the review (DuckDuckGo and URL fetching are suppressed).
- The output still follows the same 7-section structure as standard Review; citations are reviewed from the paper text only and marked "Not verifiable (offline mode)" where applicable.
- A visible label in the output header distinguishes offline-mode output from web-grounded output.
- Review (offline) works with all supported models, including `gemma3:1b` (which does not support tool-calling in standard Review mode).

#### FR-9: Review output display

The review streams into the Pane Chat Panel labeled "Peer Review." The SSE stream uses two distinct event types: `tool_call` (emitted each time the model invokes `web_search` or `fetch_url`, carrying the tool name and arguments) and `token` (emitted for each output token of the model's final response). The frontend renders `tool_call` events as collapsible transient status lines during the agent loop; `token` events stream into the review message bubble.

**Consequences (testable):**
- Tool-call status lines (e.g. `→ web_search("Smith 2020 attention NeurIPS")`) are rendered in real time from `tool_call` SSE events during the agent loop.
- Once the model produces its final response, `token` events stream it token-by-token into the review message bubble.
- After the final response starts streaming, the tool-call status lines collapse (or are visually demoted) to keep the review content in focus.
- Visually distinct label from Summarize output and free-form messages.
- The "Search web" toggle has no effect when Review is active — the agent always has web tools available.

---

### 4.4 Web Search Grounding

**Description:** A "Search web" toggle in the Pane Chat Panel input area. When enabled, the Local Backend executes a web search before calling the model, injecting the top 3–5 result snippets into the prompt. Used for looking up concepts, terminology, or related work. Realizes UJ-3.

**Functional Requirements:**

#### FR-10: Web search toggle

A "Search web" toggle appears in each Pane Chat Panel's input area for free-form chat. When active, the next submission dispatches a DuckDuckGo search (via the `ddgs` Python library — no API key required) and injects the top result snippets into the prompt. The toggle resets to off after each submission. Note: the Review shortcut always has web tools available via the ReAct agent loop (FR-8) regardless of this toggle.

**Consequences (testable):**
- With toggle on: the panel shows a "Searching…" indicator, then "Found N results," then begins streaming the grounded response.
- With toggle off: no web search; submission goes directly to the model.
- If web search fails (no internet, timeout): an inline warning appears and the model answers from weights only, noting it could not reach the web.

#### FR-11: Search result attribution

Each Grounded Response displays collapsible source chips (title + URL) below the assistant message.

**Consequences (testable):**
- At least one source chip appears on every Grounded Response.
- URLs open in the system browser on click.

---

### 4.5 Local Backend — Python / Ollama Full Integration

**Description:** A FastAPI Python server launched as a child process by the Electron main process on app startup. It is responsible for the complete Ollama lifecycle: detecting whether Ollama is installed, downloading the Ollama binary if absent, starting and monitoring the Ollama process, pulling models, and routing all inference and search requests. The user takes no manual action to set up Ollama or Python — the app handles everything. Python itself is bundled inside the Electron package.

**Functional Requirements:**

#### FR-12: Backend lifecycle management

The Electron main process spawns the Local Backend on launch using the bundled Python environment. The backend binds to a random unused local port communicated to the renderer via IPC. It is terminated when the Electron app closes.

**Consequences (testable):**
- The PDF reader UI is fully functional before the backend finishes starting (backend startup is non-blocking).
- The Pane Chat Panels display a "Starting AI engine…" status while the backend is initializing.
- The backend process is terminated cleanly when the Electron window closes; no zombie processes remain.
- If the backend crashes, both Pane Chat Panels enter a recoverable "AI unavailable — restart the app" error state without affecting PDF reading.

#### FR-13: Ollama auto-install and auto-start

On first run, the Ollama Manager checks whether the Ollama binary is present (in the app's data directory or on the system PATH). If absent, it downloads the appropriate Ollama binary for the OS/arch from the official Ollama release URL and saves it to the app's data directory. It then starts the Ollama process and monitors it for the duration of the app session. If Ollama was already installed system-wide, that installation is used.

**Consequences (testable):**
- On first run without Ollama: a progress indicator in the Pane Chat Panel shows "Downloading AI engine…" with a percentage.
- On subsequent runs: Ollama starts within 3 seconds without re-downloading.
- If the download fails (no internet), the panel shows a clear error with a "Retry" button; the PDF reader remains fully functional.
- If the system already has Ollama (on PATH), the app uses it without downloading.
- Ollama is started with `OLLAMA_NUM_PARALLEL=1` and `OLLAMA_MAX_LOADED_MODELS=1` to minimize CPU contention.

#### FR-14: Default model auto-pull

On first run, after Ollama is started, the Ollama Manager checks whether the default model (`llama3.2:3b` Q4_K_M, ~2.0 GB) is present locally. If not, it initiates a pull with a progress indicator in the Pane Chat Panel. The user can use the PDF reader normally during the download.

**Consequences (testable):**
- Model pull progress (percentage, download speed, ETA) is visible in the Pane Chat Panel.
- Both Pane Chat Panels show pull progress simultaneously (shared backend state).
- After pull completes, the model auto-loads and chat becomes active.
- If the pull is interrupted (app closed mid-download), it resumes or restarts cleanly on next launch.

#### FR-15: Model Browser — pull and switch any Ollama model

The Pane Chat Panel includes a Model Browser accessible via a "Change model" control. It shows currently downloaded models and allows the user to search for and pull any model available in the Ollama registry. The user can switch the active model at any time; switching clears the current chat session.

**Consequences (testable):**
- The model dropdown lists all locally available Ollama models.
- The user can enter any valid Ollama model tag (e.g. `qwen3.5:2b`, `gemma3:1b`, `mistral:7b`) and pull it.
- Pull progress is shown inline; the existing model remains active until the new one is ready.
- Switching models clears the chat thread and resets conversation history on the backend.
- The selected model persists in `localStorage` across app restarts.

#### FR-16: Streaming response delivery

The backend streams tokens from Ollama's streaming chat endpoint to the frontend via Server-Sent Events (SSE) over the local HTTP connection.

**Consequences (testable):**
- First token arrives at the frontend within 3 seconds of submission (4-core CPU, default 3B Q4 model, ≤4 000-token context).
- Clicking "Stop generation" terminates the Ollama request immediately; no further tokens arrive.
- No token is dropped or duplicated during streaming.

#### FR-17: Prompt construction and context trimming

The backend prepends the Pane Context (extracted PDF text) to the user message, respecting the model's context limit. Text is trimmed from the end of the document when the limit is exceeded. A warning flag is returned to the frontend when trimming occurs.

**Consequences (testable):**
- No request exceeds the model's declared context length.
- The frontend receives a `context_truncated: true` flag in the SSE stream metadata when trimming occurred.
- The Pane Chat Panel renders a visible warning chip on truncated responses.

---

### 4.6 Text Selection → Pane Chat Panel

**Description:** The existing floating selection bar (Copy / Highlight / Note) gains an "Ask AI" button. Clicking it sends the selected text to the Pane Chat Panel of the pane from which the text was selected. Realizes UJ-3.

**Functional Requirements:**

#### FR-18: "Ask AI" on text selection

When the user selects text in a pane and taps "Ask AI" on the floating bar, that pane's Pane Chat Panel opens (if closed), the input is pre-filled with "Explain: {selected text}", and the message is submitted automatically.

**Consequences (testable):**
- The pane's Pane Chat Panel opens if not already open.
- The submitted message is visible in the thread as a user message.
- The context used is always from the same pane in which the text was selected.

`[NOTE FOR PM: The existing #selection-float is a single global overlay with no pane-origin attribute. FR-18 requires routing the "Ask AI" action to the correct pane's chat. Implementation must tag the selection event with its source pane (left/right) — this is an architecture decision with no equivalent in the current codebase. Decide before the FR-18 sprint.]`

**Out of Scope:**
- Sending images or figures to the model (text-only in v1). `[NON-GOAL for MVP]`

---

## 5. Non-Goals (Explicit)

- **Cloud LLM calls**: No OpenAI, Anthropic, or other remote API integration in v1.
- **Android LLM features**: Pane Chat Panels are Electron-desktop-only. The Android build is unchanged.
- **Web app LLM features**: The hosted web/browser build does not expose Pane Chat Panels.
- **PDF annotation by the model**: The model cannot write highlights or notes into the document.
- **Multi-turn memory across sessions**: Conversation history does not persist across app restarts.
- **Document ingestion into a vector store / RAG database**: v1 uses simple in-prompt context injection, not a vector index.
- **Cross-pane context**: The model sees only one pane's document per chat. Cross-pane comparison prompts (both documents simultaneously) are out of scope.
- **Model fine-tuning or training**: The system uses models as-is from Ollama's registry.
- **Image/figure understanding**: Text-only in v1; multimodal models at 2B scale on CPU are not practical.

---

## 6. MVP Scope

### 6.1 In Scope

- Per-pane Pane Chat Panels (left and right, independently collapsible, within each pane's boundaries)
- Summarize shortcut — FR-6, FR-7
- Review shortcut (web + offline modes) — FR-8, FR-9, FR-19
- Free-form chat with pane-bound context — FR-1 through FR-5
- Web search grounding toggle — FR-10, FR-11 (`duckduckgo-search` Python library as default)
- "Ask AI" from text selection floating bar — FR-18
- Local Backend: FastAPI Python server, bundled Python environment, Electron child_process launch — FR-12
- Ollama auto-install + auto-start (first-run download of binary) — FR-13
- Default model auto-pull: `llama3.2:3b` (Q4_K_M, ~2.0 GB) — FR-14
- Model Browser: pull and switch any Ollama model — FR-15
- Streaming via SSE — FR-16, FR-17
- Graceful degradation: full PDF reader functionality when backend is unavailable
- Electron-only: AI features isolated on a feature branch; Android and web builds untouched

### 6.2 Out of Scope for MVP

- Cross-pane / multi-document context — deferred to v2; requires significant prompt engineering `[NOTE FOR PM: high value for comparative analysis]`
- Persistent chat history across sessions — deferred to v2
- RAG / vector index for long documents — deferred to v2
- Model management UI (delete models, view disk usage) — deferred to v2
- SearXNG as a configurable web search backend — deferred to v2; DuckDuckGo scraping is the v1 default
- Android LLM support — requires on-device runtime; out of scope
- Custom system prompt editing — deferred to v2
- Export chat as markdown/PDF — deferred to v2 `[NOTE FOR PM: high value, low effort]`
- OCR for scanned/image-only PDFs — deferred; significant Python dependency

---

## 7. Cross-Cutting NFRs

**Performance**
- **NFR-1**: First token latency ≤ 3 seconds on a 4-core CPU laptop with the default 3B Q4 model and ≤4 000-token context.
- **NFR-2**: Pane Chat Panel open/close and inference must not block or degrade PDF rendering, page navigation, or annotation in either pane.
- **NFR-3**: Backend startup must not delay app readiness; the PDF reader is fully functional before the backend becomes healthy.

**Privacy**
- **NFR-4**: No document text, user messages, or model responses leave the local machine. Network calls fall into three categories: (1) always-local — Ollama inference on `localhost:11434`; (2) first-run-only — Ollama binary and model downloads from official Ollama servers; (3) user-initiated — DuckDuckGo web search and URL fetching, triggered explicitly via the Search web toggle (free-form chat) or the Review shortcut (which always uses web tools unless "Review offline" is selected). The Help dialog must enumerate all three categories.
- **NFR-5**: The Help dialog privacy section must accurately describe AI data handling, including what is downloaded, what leaves the machine for web search, and how to use Review in offline mode.

**Reliability**
- **NFR-6**: Backend crashes must not crash the Electron app; both Pane Chat Panels enter a recoverable error state independently.
- **NFR-7**: If Ollama is killed mid-inference, the streaming response aborts cleanly; the rest of the app is unaffected.
- **NFR-8**: Ollama binary and model downloads must be resumable; an interrupted download does not corrupt the local state.

**Accessibility**
- **NFR-9**: Each Pane Chat Panel is keyboard-navigable; all interactive elements have accessible labels. Streaming text is announced to screen readers on completion, not token-by-token.

**Resource**
- **NFR-10**: The Python backend consumes < 100 MB RAM when idle. Model memory is Ollama's responsibility (~1.5–2 GB for a 3B Q4 model).
- **NFR-11**: The bundled `uv` venv (Python interpreter + all dependencies) must not increase the compressed Electron installer size by more than 150 MB. `[NOTE FOR PM: conduct a package audit (uv sync + du -sh) before locking this number — the FastAPI/uvicorn/httpx/pydantic dependency chain alone is typically 60–100 MB uncompressed; combined installer overhead should be verified on all three target OSes before the first release.]`

---

## 8. Platform and Distribution

- **Desktop (Electron)**: Primary target. Pane Chat Panels fully enabled. Python backend bundled. Ollama managed automatically.
- **Feature branch**: All AI-related changes (frontend, backend, build config) are developed on a dedicated Electron feature branch, keeping the main branch free of AI-specific code until the feature is ready to merge.
- **Android (Capacitor)**: Existing build unchanged. No AI code present in the Android branch.
- **Web (browser)**: Existing web build unchanged. No AI code present.
- **Python runtime**: Bundled via `uv`-managed virtual environment (venv) included in `extraResources`. Created at build time via `uv sync`; spawned by Electron's `child_process` using the venv's Python interpreter. Does not require the user to install Python. (OQ-2 resolved.)
- **Core Python dependencies** (from the proven `manuscript2presentation` stack):
  - `ollama>=0.4.0` — Ollama Python client (chat, streaming, tools, model management)
  - `pypdf>=4.0.0` — PDF text extraction for Review backend
  - `ddgs>=9.14.4` — web search (no API key; `duckduckgo-search` has been renamed to `ddgs` — use the new package name)
  - `requests` — URL fetching for `fetch_url` tool in ReAct loop
  - `fastapi` + `uvicorn` — local HTTP server and SSE streaming to Electron renderer
- **Ollama binary**: Downloaded automatically to the app's data directory on first use. Minimum supported Ollama version: 0.3+. If a system Ollama is already installed, it is used in preference to downloading.
- **Default model**: `llama3.2:3b` (Q4_K_M, ~2 GB RAM, supports Ollama tool-calling API). Fallback options in the Model Browser: `qwen3.5:2b` (1.28 GB, top benchmark score in class), `gemma3:1b` (smallest/fastest). Note: `gemma3:1b` does not support Ollama tool-calling; Review shortcut will fall back to non-tool mode if selected.
- **Bundled review prompt**: The `ai-dm-paper-review/SKILL.md` system prompt is shipped as a bundled asset in `extraResources` alongside the Python backend.

---

## 9. Success Metrics

**Primary**
- **SM-1**: Summarize used ≥ 3 times per week by the developer on their own research workflow within the first month of v1 shipping. Validates FR-6.
- **SM-2**: Time-to-summary for a 20-page PDF ≤ 45 seconds wall-clock (button click to complete response, 4-core laptop, default `llama3.2:3b`). Validates NFR-1, FR-6.

**Secondary**
- **SM-3**: Zero app crashes attributable to backend or Ollama lifecycle in a 4-week soak test. Validates FR-12, FR-13, NFR-6.
- **SM-4**: First-run Ollama + model download completes without user error on a fresh machine with internet access. Validates FR-13, FR-14.

**Counter-metrics (do not optimize)**
- **SM-C1**: Response quality must not be traded for speed — do not shrink context below FR-17's trimming rules solely to hit NFR-1 targets.
- **SM-C2**: Privacy must not be compromised for features — do not add telemetry, remote logging, or cloud model fallback.

---

## 10. Open Questions

1. **Web search backend**: `duckduckgo-search` Python library confirmed for v1 (zero user setup, no API key). Rate-limited and scrape-based; SearXNG is the v2 upgrade path. *Resolved.* `[NOTE FOR PM: document SearXNG upgrade path in architecture doc]`
2. **Python bundling strategy**: *Resolved.* `uv`-managed venv in `extraResources` — debuggable, avoids PyInstaller's binary-freeze complexity, and allows the venv to be inspected or updated independently of the Electron build. The venv is created at build time by `uv sync` and included in the packaged app via `extraResources`. The Electron main process spawns the Python interpreter from the venv's `bin/python` (or `Scripts/python.exe` on Windows) using the `child_process` API.
3. **Ollama binary download URL strategy**: Ollama's GitHub releases page is the canonical source. Need to handle OS detection (Linux x86_64, macOS arm64/x86_64, Windows x64) and version pinning. Decide whether to pin a specific Ollama version or always pull latest.
4. **Long document truncation**: For papers > 30 pages, what is trimmed — end of document only, or beginning + end retained with middle cut? Deferred to architecture.
5. **Context extraction for scanned PDFs**: pdfjs text layer yields nothing for image-only PDFs. OCR (e.g. via Tesseract in Python) is significant complexity; deferred to v2.
6. **Pane Chat Panel height**: What fraction of the pane height does the chat drawer occupy by default? Is it user-resizable? `[ASSUMPTION A13: ~30% of pane height, resizable via drag handle]`
7. **ReAct tool-calling model compatibility**: Not all small models support Ollama's `tools` API. The default `llama3.2:3b` does support tool-calling. If the user switches to a model that does not, the Review shortcut must detect this and fall back gracefully to a non-tool prompt. Handling needs to be defined in implementation.

---

## 11. Assumptions Index

- **A1**: Pane Chat Panels are Electron-only. Android and web builds are unchanged and have no AI code. All AI changes are developed on a dedicated Electron feature branch. (§2.2, §5, §6.1, §8)
- **A2**: "Review" means a 7-section structured academic critique (§1 Summary, §2 Strengths, §3 Detailed Review [with 8 subsections: Technical Correctness, Consistency, Clarity, Research Integrity, Citations, Authenticity, Novelty, Fit for Venue], §4 Gaps, §5 Suggestions, §6 Citation Suggestions, §7 Overall Assessment + Score + Recommendation). Driven by the bundled review system prompt and executed via a ReAct agent loop with web tools. (§4.3, FR-8)
- **A3**: "Query internet" means DuckDuckGo search results injected as context into the LLM prompt — not live browsing or a separate web view. (§4.4, FR-10)
- **A4**: The Python backend is bundled inside the Electron package (`extraResources`) and launched as a child process. Users do not install Python. (§4.5, §8)
- **A5**: Each Pane Chat Panel is a bottom drawer within its pane's visual boundaries. In split view, both panels are independent. In single-pane view, only the active pane's panel is shown. (§4.1, FR-1)
- **A6**: Each Pane Chat Panel's context is permanently bound to its own pane's document. No cross-pane or focus-based context switching. (§3, FR-4)
- **A6a**: Pane Context is capped at ~8 000 tokens; text from the end of the document is trimmed when the limit is exceeded. (FR-4, FR-17)
- **A7**: Chat history is session-only; not persisted across app restarts in v1. (§3)
- **A8**: Ollama is fully managed by the app — auto-downloaded and auto-started. The user takes no manual Ollama setup steps. (§4.5, FR-13, §8)
- **A9**: Default model is `llama3.2:3b` (Q4_K_M, ~2.0 GB). The Model Browser allows the user to pull and switch to any Ollama model. (FR-14, FR-15)
- **A10**: The Review shortcut uses a ReAct agent loop (Ollama tool-calling) — the model autonomously invokes `web_search` and `fetch_url` to verify citations. There is no pre-extraction citation batch step. Maximum 30 tool-call rounds per review session. (FR-8)
- **A11**: File path (not extracted text) is passed from Electron to the Python backend for Review; the backend runs `pypdf.PdfReader` independently, up to 50 000 characters. For free-form chat, the frontend sends already-extracted pdfjs text (up to 8 000-token cap). (FR-4, FR-8)
- **A12**: A "Review (offline)" secondary action ships in v1 — accessible via long-press or dropdown on the Review button — running the same review prompt without web tools. (FR-8, FR-19)
- **A13**: Default Pane Chat Panel height is ~30% of the pane height; the panel is resizable by the user via a drag handle. (§4.1, OQ-6)
