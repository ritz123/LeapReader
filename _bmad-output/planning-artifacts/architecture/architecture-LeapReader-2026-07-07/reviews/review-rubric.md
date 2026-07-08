# Spine Rubric Review

## Verdict

The spine is well-structured, covers all 19 FRs, and its ADs are individually enforceable — but two cross-unit operational protocols (abort chain and sidecar crash-recovery) are completely unspecified, and the SSE event contract is incomplete for two FR-required data flows (search attribution and model-pull progress), all of which constitute real divergence risks at implementation time.

---

## Findings

### high — Abort chain has no governing AD

FR-3 requires "Stop generation" to terminate the Ollama request immediately (the testable consequence is "no further tokens arrive"). The IPC channels `ai:abort:left/right` appear in Conventions, and `/abort` appears in the structural seed, but no AD specifies the handshake across the four layers: renderer emits IPC abort → Main calls HTTP DELETE (or POST) `/abort/{pane_id}` on the sidecar → sidecar cancels the `asyncio` streaming task → Ollama streaming connection is closed. Without this, an implementer could stop at the renderer (halt token rendering) while Ollama continues burning CPU, or could implement abort as a fire-and-forget HTTP call with no confirmation, and both would silently violate FR-3. The convention table does not substitute for an AD here because abort spans three process boundaries.

**Fix:** Add AD-13 — Abort protocol. Specify: (1) renderer sends `ai:abort:{pane_id}` IPC; (2) Main calls `POST /abort/{pane_id}` on the sidecar; (3) sidecar cancels the in-flight `asyncio` task (SSE generator), emits a final SSE `error` event with `code: "ABORTED"`, and returns HTTP 200; (4) Main forwards the final SSE event to the renderer via the normal `ai:stream:{pane_id}` channel. Bind to FR-3, FR-16.

---

### high — Sidecar crash-recovery policy missing from AD-4

AD-4 assigns Electron Main as the sidecar's lifecycle owner (spawn on start, kill on quit) but says nothing about what Main does if the sidecar exits unexpectedly after a successful startup — which is exactly the scenario NFR-6 tests. NFR-6 requires both Pane Chat Panels to enter a recoverable "AI unavailable — restart the app" state independently, without crashing Electron. There is no AD, convention, or deferred item specifying: whether Main should attempt a restart, how many times, what IPC event it emits to the renderer on unexpected sidecar exit (e.g., `backend:down`), or whether Main should also kill and restart Ollama in that event. Two implementers will make incompatible choices here.

**Fix:** Extend AD-4 to add a crash-recovery clause: on unexpected sidecar exit (non-zero exit code or signal), Main emits `backend:down` to all renderer windows immediately (triggering recoverable error state per NFR-6), then attempts a restart with exponential backoff (suggested: 3 attempts at 2 s, 4 s, 8 s). After exhausting retries, emit `backend:failed` (no further restart). Renderer maps `backend:down` → "AI unavailable, retrying…" and `backend:failed` → "AI unavailable — restart the app." Bind to NFR-6, FR-12.

---

### medium — SSE envelope (AD-3) is silent on search result attribution

FR-11 requires source chips (title + URL) to appear beneath every Grounded Response. The SSE event envelope in AD-3 defines four event types — `token`, `tool_call`, `meta`, `error` — and the `meta` payload is explicitly enumerated as `{context_truncated, review_offline, model_no_tools, partial_text}`. No field or event carries structured search result data (title + URL pairs) from the sidecar to the renderer. An implementer must invent a mechanism from scratch: inject results into the token stream as Markdown, add a fifth SSE type, or embed them in a `meta` payload field not yet defined. Each choice creates a different wire format, and `chat_router.py` and `useSSEStream.ts` will diverge.

**Fix:** Extend AD-3 to define how search attribution data is delivered: add a `sources` field to the `meta` event payload — `payload.sources: [{title: string, url: string}]` — emitted as a single `meta` event immediately before the first `token` event when web search was performed (web toggle on, or Review with web tools). Bind to FR-10, FR-11.

---

### medium — Model pull progress has no defined cross-layer protocol

FR-14 requires pull progress (percentage, download speed, ETA) to appear in the Pane Chat Panel. The Deferred section correctly acknowledges "pull-progress event frequency and UI debounce" as deferred, but the cross-layer protocol is not deferred — it is entirely absent. Ollama pull progress is available from `ollama.pull(model, stream=True)` on the sidecar, but there is no SSE event type for it (AD-3 does not cover it), no IPC channel for it (Conventions lists only `backend:ready`, `ai:stream:*`, `ai:abort:*`), and no module-level convention for when and how the sidecar broadcasts pull progress to the renderer (which may not have an active chat session when the pull happens). Two units (`ollama_manager.py` and `PaneChatPanel`) will make incompatible assumptions.

**Fix:** Add a convention (or extend AD-4): Sidecar emits pull progress as SSE `meta` events with payload `{pull_progress: {model: string, percent: number, speed_mbps: number, eta_s: number}}` on a dedicated SSE endpoint `GET /pull-progress` (not pane-scoped, since pull is global). Main subscribes to this endpoint on startup and forwards events to all renderer windows via a new IPC channel `backend:pull_progress`. Bind to FR-14.

---

### medium — `ollama` Python client version conflicts between spine and PRD

The spine Stack table pins the Ollama Python client at `0.6.2`. The PRD §8 specifies `ollama>=0.4.0`. These are not contradictory at runtime (0.6.2 satisfies >=0.4.0), but the divergent constraint expressions will create confusion at pyproject.toml authorship time, and the spine's specific pin cannot be independently verified as the current stable release without checking PyPI. If 0.6.2 is not the latest stable (e.g., 0.7.x has shipped), the spine is stale on its own "Named tech is verified-current" criterion. Additionally, "FastAPI latest stable" and "duckduckgo-search latest stable" in the Stack table are not pinned at all, which conflicts with the Conventions note that deps are pinned in `pyproject.toml` — the spine should state the pinned versions or explicitly defer pinning with a comment.

**Fix:** Verify `ollama==0.6.2` against PyPI at spine-finalization time; update to the current latest if needed. Align the PRD floor to `ollama>=<pinned_version>`. Add verified pins for FastAPI and uvicorn to the Stack table (or add a Deferred note: "FastAPI/uvicorn pins to be set at pyproject.toml authorship; target latest stable at branch creation time").

---

## Checklist Summary

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Fixes real divergence points; misses none | **Partial** — abort chain and crash recovery are real divergence points with no AD |
| 2 | Every AD's Rule is enforceable and prevents its stated divergence | **Pass** — all 12 ADs have enforceable, specific rules |
| 3 | Nothing under Deferred could let two units diverge | **Pass** — all deferred items touch single modules |
| 4 | Named tech is verified-current | **Partial** — `ollama 0.6.2` pin unverified; FastAPI/duckduckgo-search unpinned |
| 5 | Ratifies rather than contradicts brownfield codebase | **Pass** — existing Electron/pdfjs versions carried forward; AI code branch-isolated |
| 6 | Covers all spec capabilities (19 FRs) | **Pass** — all FR-1 through FR-19 appear in `binds` and Capability Map |
| 7 | Every dimension decided, deferred, or open question | **Partial** — operational envelope acknowledged in Deferred; SSE protocol has two silent dimensions (search attribution, pull progress) |
