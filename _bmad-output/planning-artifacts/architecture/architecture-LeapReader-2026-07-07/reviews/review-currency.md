---
type: architecture-review
subtype: currency
spine: ARCHITECTURE-SPINE.md
reviewer: automated-currency-check
date: 2026-07-07
status: findings-require-action
---

# Architecture Currency Review — LeapReader AI Research Assistant

## Verdict

The spine is **mostly current** but contains **two actionable errors** that will cause silent runtime failures: a deprecated package name and a non-existent exception class; Electron ^34 is also significantly behind current stable and warrants a tracked upgrade.

---

## Findings

### FINDING 1 — `duckduckgo-search` is frozen; correct package is `ddgs` [CORRECTION REQUIRED]

**What was checked:** PyPI package page for `duckduckgo-search` (verified 2026-07-07).

**Result:** The `duckduckgo-search` package was frozen at v8.1.1 in July 2025 and officially renamed to `ddgs`. The PyPI page now shows a prominent warning: *"This package has been renamed to `ddgs`! Use `pip install ddgs` instead."* The frozen package no longer receives DuckDuckGo anti-bot fixes, meaning web-search functionality will silently degrade over time. The replacement `ddgs` is actively maintained at v9.14.4 (released 2026-05-15).

**Impact:** `backend/web_tools.py` and `pyproject.toml` would install a frozen, unmaintained package. Web-search tool calls will fail as DuckDuckGo changes its API, with no upstream fix available.

**Correction:** Replace `duckduckgo-search` with `ddgs` everywhere in the spine and implementation. The API is a drop-in replacement — same `text(query, max_results=N)` call signature and `{title, href, body}` result shape. Import changes from `from duckduckgo_search import DDGS` to `from ddgs import DDGS`.

---

### FINDING 2 — `ToolNotSupportedError` does not exist in the ollama Python client [CORRECTION REQUIRED]

**What was checked:** `ollama/_client.py` source on GitHub (tag v0.6.2), GitHub issues #223 and #5967, and PyPI page for `ollama` v0.6.2 (verified 2026-07-07).

**Result:** The ollama-python client (v0.6.2) raises **`ollama.ResponseError`** (defined in `ollama._types`) when a model does not support tools — with an error message of the form `"<model> does not support tools"`. There is no `ToolNotSupportedError` class in the library at any version. AD-8 specifies catching `ToolNotSupportedError`, which will never match; the exception will propagate uncaught, breaking the offline-mode fallback.

**Impact:** AD-8's tool-capability detection will be a no-op. Any non-tool model will cause an unhandled `ResponseError` to bubble up to the user instead of cleanly downgrading to offline review mode.

**Correction:** In `backend/review_agent.py`, catch `ollama.ResponseError` and inspect the message:
```python
except ollama.ResponseError as e:
    if "does not support tools" in str(e).lower():
        # emit meta.model_no_tools: true, downgrade to offline mode
    else:
        raise
```
Update AD-8 to reference `ollama.ResponseError` rather than `ToolNotSupportedError`.

---

### FINDING 3 — `ollama` Python client 0.6.2: tools API and `stream=True` CONFIRMED CURRENT [VERIFIED OK]

**What was checked:** PyPI version history for `ollama` (verified 2026-07-07), GitHub release page for v0.6.2, official Ollama docs at `docs.ollama.com/capabilities/tool-calling` and `docs.ollama.com/capabilities/streaming`.

**Result:** v0.6.2 is confirmed as the current latest release (published 2026-04-29). The tools API (via `tools=[...]` parameter to `ollama.chat()`) was introduced in v0.3.0 and is fully supported in v0.6.2. `stream=True` is also fully supported — when used with tools, chunks accumulate `tool_calls` fields. AD-11's two-pass design (synchronous tool turns + streaming final response) is a valid and documented pattern that avoids the complexity of accumulating streamed tool calls.

**No correction needed.**

---

### FINDING 4 — `pypdf ≥4.0` is valid; current release is 6.14.2 [VERIFIED OK]

**What was checked:** PyPI page for `pypdf` (verified 2026-07-07); `PdfReader.pages[i].extract_text()` API docs.

**Result:** `pypdf` current stable is v6.14.2 (released 2026-06-23), well above the ≥4.0 floor. `PdfReader.pages[i].extract_text()` has been stable since 4.x. AD-7's extraction pattern — iterating pages with `pypdf.PdfReader` and joining with `"--- PAGE BREAK ---"` in application code — is correct; pypdf does not natively emit page-break markers, and the spine's architecture correctly places that responsibility in `context_utils.py` rather than in the library. The `≥4.0` constraint is well-satisfied and the extraction API is stable.

**Note:** `pypdf` also now has a `page_labels` property (added in ~3.5.x) that could be used to emit semantically meaningful page labels (e.g., Roman numerals for front matter) rather than a flat break string — worth noting as an optional enhancement, not a defect.

**No correction needed.**

---

### FINDING 5 — `llama3.2:3b` Q4_K_M exists in Ollama registry and supports tool-calling [VERIFIED OK]

**What was checked:** `ollama.com/library/llama3.2:3b` (verified 2026-07-07).

**Result:** The model page confirms the default quantization is **Q4_K_M** and explicitly lists **"Tool use"** as a supported capability. The model is 2.0 GB. Tool-calling has been stable on llama3.2 since the model's Ollama launch. Confirmed present in the public registry; `ollama pull llama3.2:3b` will fetch the correct Q4_K_M artifact.

**No correction needed.**

---

### FINDING 6 — Electron ^34 is 9 major versions behind current stable [RISK — TRACKED EXISTING CONSTRAINT]

**What was checked:** `releases.electronjs.org` (verified 2026-07-07).

**Result:** Current Electron stable is **v43.0.0** (released 2026-06-29). Electron follows an 8-week release cycle and supports only the 3 most-recent stable majors (currently v41, v42, v43). Electron 34 is outside the support window and will not receive security patches. The `child_process.spawn()` API used to launch the Python sidecar is stable and backward-compatible across all Electron versions in scope, so the API itself is not broken — but the security and Chromium exposure is significant.

**The spine correctly annotates this as "(existing)"**, meaning it is a pre-existing constraint, not a choice of this feature sprint. However, the feature introduces a locally-bound Python sidecar and IPC surface that will only be validated on Electron 34, making a future upgrade more complex.

**Recommendation (not a blocker):** File a tracked upgrade ticket to bring LeapReader to Electron 41+ before the AI feature ships to end users. The `child_process`/`app.before-quit`/`app.getPath()` APIs used by `ai-bridge.mjs` are all unchanged through v43.

---

### FINDING 7 — `FastAPI`, `uvicorn`, `requests` "latest stable" designations [VERIFIED — PINNING REMINDER]

**What was checked:** PyPI pages for `fastapi` (v0.139.0, released 2026-07-01) and `uvicorn` (v0.50.2, released 2026-07-06).

**Result:** Both are actively maintained with very recent releases. FastAPI now requires Python ≥3.10 (compatible with the spine's Python 3.12). "Latest stable" in the spine is acceptable since the spine explicitly notes *"pin in pyproject.toml"* — but the actual pins must be captured at project-setup time, not left as floating. `requests` is stable and not a concern.

**Reminder, not a correction:** Pin all four to explicit versions in `pyproject.toml` at first `uv sync`. Do not ship with unpinned `latest stable` in the lockfile.

---

## Summary Table

| Item | Spine Says | Verified State | Action |
|---|---|---|---|
| `duckduckgo-search` | latest stable | **FROZEN at 8.1.1** — renamed to `ddgs` | **Replace with `ddgs`** |
| `ToolNotSupportedError` (AD-8) | catch this exception | **Does not exist** — use `ollama.ResponseError` | **Fix AD-8 + code** |
| `ollama` Python client 0.6.2 | 0.6.2, tools + stream | Confirmed current, tools + stream both work | OK |
| `pypdf ≥4.0` | text extraction + page markers | v6.14.2 stable; extraction API correct | OK |
| `llama3.2:3b` Q4_K_M | default model | Registry-confirmed, Q4_K_M, tool-capable | OK |
| Electron ^34 | existing | Current stable is v43; v34 out of support | Track upgrade (existing) |
| FastAPI / uvicorn | latest stable | FastAPI 0.139.0, uvicorn 0.50.2 | Pin at first uv sync |
| Ollama runtime ≥0.3 | minimum 0.3 | Current is v0.31.1; min seems low (tools need ≥0.5) | Consider raising minimum |
