# Adversarial Spine Review

## Verdict

The spine's four adopted ADs hold the happy path together well but leave four seams — args schemas, request body field names, abort session semantics, and shutdown ownership — where two units can each cite chapter and verse and still fail to connect.

---

## Incompatible Pairs Found

---

### Pair 1 — SSE `tool_call` args schema is an untyped blob

**Unit A:** `review_agent.py` — implements the ReAct loop per AD-11 and emits SSE `tool_call` events per AD-3. AD-3 specifies `payload.tool: "web_search"|"fetch_url"` and `payload.args: object`. The agent satisfies the letter of AD-3 by writing `payload.args` however it likes: `{q: "string"}` for web_search and `{href: "url"}` for fetch_url, mirroring the underlying `duckduckgo_search` and `requests` call signatures.

**Unit B:** `useSSEStream.ts` — consumes SSE `tool_call` events per AD-3 to render a tool-status badge. It reads `event.payload.args.query` and `event.payload.args.url` respectively, which are the conventional names any TypeScript developer would choose from the SSE envelope description.

**Incompatibility:** AD-3 defines `payload.args: object` with zero internal structure. Unit A emits `{q, href}`; Unit B reads `{query, url}`. Both are fully AD-3-compliant. The renderer always renders an empty or `undefined` tool-status display — silently, no type error, no runtime crash — and the developer finds out at integration time.

**Exposed AD:** AD-3 — `payload.args` is specified only as `object`, making the contract between the Python emitter and the TypeScript consumer entirely implicit.

**Fix:** Extend AD-3 with a per-tool args schema table:

```
tool_call payload shapes:
  web_search  → payload.args: { query: string }
  fetch_url   → payload.args: { url: string }
```

Add a matching TypeScript discriminated union in `src/ai/types.ts` and a Pydantic model in `review_agent.py`; both are normative, not advisory.

**File:** `ARCHITECTURE-SPINE.md` → AD-3

---

### Pair 2 — Chat/Review request body field names are never defined

**Unit A:** `context_utils.py` — implements the Review extraction path per AD-7 ("frontend sends the PDF file path only; backend extracts via pypdf"). It expects an incoming FastAPI request with a field it names internally — say `file_path: str` — and returns processed text. For the Chat/Summarize path, `chat_router.py` reads whatever field name carries the pdfjs-extracted text from the request body; a natural choice is `context_text: str`.

**Unit B:** `PaneChatPanel` — implements the Chat/Summarize path per AD-7 ("frontend extracts text from the pdfjs text layer and sends it in the request body"). The developer chooses a field name without guidance: `context`, `pdfContent`, `extracted_text`, or `body` are all plausible. AD-7 says what to extract and who extracts it; it says nothing about how to name the wire field.

**Incompatibility:** Unit A reads `request.context_text`; Unit B posts `body.pdfContent`. Both developers obeyed every line of AD-7. The backend silently receives `None` for context on every chat request. No pane-bound context is ever injected, no error raised.

**Exposed AD:** AD-7 — defines *what* to send and *who* sends it but specifies no HTTP request-body schema for either path.

**Fix:** Append a normative request body table to AD-7:

```
Chat / Summarize POST body: { pane_id, session_id, message: string, context_text: string, model_tag: string }
Review POST body:           { pane_id, session_id, file_path: string, model_tag: string, web_search_enabled: bool }
```

Both `PaneChatPanel` and `chat_router.py` Pydantic models are required to match these names exactly.

**File:** `ARCHITECTURE-SPINE.md` → AD-7

---

### Pair 3 — Abort carries `pane_id` but not `session_id`; one owner, two meanings

**Unit A:** `useBackend.ts` — following AD-1 (all renderer↔backend traffic through IPC) and the Consistency Conventions (IPC channel names `ai:abort:left`, `ai:abort:right`), it handles an abort button click by emitting `ai:abort:left` over IPC. AD-2 says "every backend API request carries `pane_id`" — but an IPC abort signal is not a backend API request; it carries only the pane name embedded in the channel identifier. No session_id is included because no AD requires it on abort.

**Unit B:** `chat_router.py` — implements `POST /abort` following AD-2 ("no request may omit `pane_id`"). The developer reasons: AD-2 keys the conversation store on `(pane_id, session_id)`, so aborting by pane_id alone would kill every session for that pane. To be safe and session-precise, they require `{pane_id, session_id}` in the abort body. This is consistent with AD-2's tuple key.

**Incompatibility:** Unit A sends an IPC abort with no session_id (the channel name *is* the pane); Main forwards it to `POST /abort {pane_id: "left"}`. Unit B requires `session_id` and returns `422 Unprocessable Entity`. Abort silently never reaches the backend; the streaming SSE continues indefinitely. Both units obeyed their respective ADs.

A second fault: no AD prohibits concurrent requests on the same pane (e.g., a chat and a review both in flight). If abort is pane-level, it ambiguously kills both. If session-level, the IPC channel design is wrong. The spine is silent on both points.

**Exposed AD:** AD-2 — does not cover abort semantics, does not define what the abort IPC event must carry, and does not prohibit concurrent in-flight requests per pane.

**Fix:** Add a new rule (AD-13 or append to AD-2):

> The abort IPC event `ai:abort:{pane_id}` must carry `{ session_id: string }` in its payload. Main must forward `POST /abort { pane_id, session_id }` to the backend. Only one active streaming request per `(pane_id, session_id)` is permitted; the UI must disable send while a stream is in flight.

**File:** `ARCHITECTURE-SPINE.md` → AD-2 (and new Consistency Convention entry for abort IPC payload shape)

---

### Pair 4 — Ollama shutdown ownership diverges between system-PATH and userData binaries

**Unit A:** `ai-bridge.mjs` — following AD-4 ("Electron Main owns the Python sidecar... kill on `app.before-quit`") and AD-9 ("Check system PATH for `ollama` first; if found, use it without downloading"), it kills the sidecar on quit and trusts that the sidecar will clean up Ollama. AD-4 assigns Ollama ownership to the sidecar; Main does not touch Ollama.

**Unit B:** `ollama_manager.py` — following AD-4 ("Python sidecar owns Ollama — start, monitor with restart-on-crash") and AD-9, it knows at startup whether Ollama was found on PATH or downloaded to userData. On SIGTERM from Main, a developer who cares about system hygiene does NOT kill a system Ollama (other applications may depend on it) — so they check the provenance flag and skip the kill. A developer who cares about leaving no zombie processes kills Ollama regardless, reasoning that AD-4 says the sidecar "owns" it.

**Incompatibility:** Two implementations of `ollama_manager.py`, both letter-perfect on AD-4 and AD-9, make opposite shutdown choices. The first leaves a system Ollama running (correct) but also leaves a userData Ollama running (leak). The second kills everything (correct for userData) but also kills the system Ollama (breaks other apps). AD-4's "owns" is undefined in the shutdown direction; AD-9's PATH-vs-userData provenance is never connected to any lifecycle rule.

**Exposed AD:** AD-4 and AD-9 together — AD-4 grants uniform "ownership" without qualifying it by provenance; AD-9 defines the provenance distinction without tying it to any lifecycle obligation.

**Fix:** Extend AD-4 with a shutdown sub-rule:

> `ollama_manager.py` must record Ollama provenance at startup as `OLLAMA_PROVENANCE = "path" | "bundled"`. On shutdown: if `"bundled"`, kill the Ollama process; if `"path"`, send no signal and leave it running. `OLLAMA_PROVENANCE` is an internal module constant, not an env var.

**File:** `ARCHITECTURE-SPINE.md` → AD-4 (cross-reference AD-9)
