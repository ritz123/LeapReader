# PRD Source Reconciliation
**PRD:** `prd-LeapReader-2026-07-07/prd.md`
**Date:** 2026-07-07

---

## Source 1 — LeapReader existing codebase (`/userworkqum/bisarkar/Fun/LeapReader/src/`)

**Gaps found:**

1. **Selection float bar has no pane-origin tracking (FR-18 unimplementable as-written)**
   `#selection-float` is a single body-level fixed overlay, not scoped to a pane. FR-18 requires it to route text to "the pane from which the text was selected," but the PRD gives zero requirement for how pane-origin detection works. A `data-pane-side` attribute or equivalent must be tracked on selection; the PRD is silent on this architecture.

2. **Float layer layout conflict for the new AI button (FR-1)**
   The float layer's bottom-right corner is already occupied by `#pane-tools-{side}` (the ⋯ FAB). FR-1 says the AI button sits "alongside" it, but the PRD does not specify whether the ⋯ FAB shifts left, whether the AI button goes bottom-left, or another arrangement. The float layer positioning scheme for two bottom-right controls is missing.

3. **Page nav pill / Pane Chat Panel spatial conflict**
   The bottom-center of the float layer holds the page-nav pill (`.pane-float-nav`). The Pane Chat Panel is a bottom-anchored drawer inside the same `.canvas-wrap`. When the panel is open, the nav pill would be obscured or inside the drawer. The PRD never addresses how the nav pill and the chat drawer coexist (e.g., nav moves above the drawer, or is overlaid inside the panel header).

4. **"Ask AI" not addressed in the ⋯ flyout Annotate group**
   The ⋯ flyout (`#pane-flyout-{side}`) already contains Copy, Highlight, Note, and Marks in its "Annotate" group — the same actions that appear in `#selection-float`. The PRD adds "Ask AI" only to the selection float bar (FR-18) but never specifies whether it should also appear in the ⋯ flyout for parity with that established pattern.

**File paths:** `index.html`, `src/reader/selection-float-bar.ts`, `src/reader/bootstrap.ts`, `src/reader/dom.ts`, `src/reader/flyouts.ts`, `src/style.css`

---

## Source 2 — `manuscript2presentation` cli.py (`/userworkqum/bisarkar/Fun/manuscript2presentation/src/text2speech/cli.py`)

**Gaps found:**

1. **`_run_review_agent` is blocking, not streaming — contradicts FR-8/FR-9**
   The source calls `_ollama.chat(**kwargs)` (blocking) in each loop iteration and returns the final string at the end. FR-8 and FR-9 both require the review to "stream token-by-token once tool-calling is complete." A direct port of `_run_review_agent` cannot stream; the backend would need `ollama.chat(stream=True)` with SSE forwarding for the final response turn only. The PRD calls this a "direct port" but streaming is incompatible with the source pattern.

2. **Tool-call status is a console.print side-effect, not a real-time IPC/SSE event**
   In `_run_review_agent`, each tool call prints to stdout: `console.print(f" [dim]→ {fn}(...)[/]")`. FR-9 requires these to appear in the Pane Chat Panel UI as real-time status lines. The source provides no mechanism to forward these signals over the local HTTP/SSE channel — a separate event or streaming protocol is needed. The PRD doesn't specify the SSE event type for tool-call status versus token output.

3. **Page-break markers in extracted text not addressed**
   The source's `paper-review` command joins PDF pages with `"\n\n--- PAGE BREAK ---\n\n"` before sending to the model. The PRD (FR-8, A11) says the backend runs `pypdf.PdfReader` and sends up to 50,000 characters, but never specifies whether page separators should be preserved. Omitting them may degrade model comprehension of document structure compared to what the proven source does.

**File paths:** `src/text2speech/cli.py` (lines 1242–1359 `_run_review_agent`, 1204–1239 `_web_search`/`_fetch_url`, 1362–1449 `paper-review` command)

---

## Source 3 — `ai-dm-paper-review` SKILL.md (`/userworkqum/bisarkar/Fun/manuscript2presentation/.cursor/skills/ai-dm-paper-review/SKILL.md`)

**Gaps found:**

1. **FR-8 and UJ-2 list only 4 of the 8 Detailed Review subsections**
   The SKILL.md defines 8 subsections under §3 Detailed Review: Technical Correctness, Consistency, Clarity/Lucidity, Research Integrity, Citation and Literature Review, Authenticity, Novelty and Contribution, Fit for Conference/Journal. FR-8's parenthetical ("subsections on technical correctness, consistency, citations, novelty") and UJ-2 omit four: **Clarity/Lucidity (3.3)**, **Research Integrity (3.4)**, **Authenticity (3.6)**, and **Fit for Conference/Journal (3.8)**. These are mandatory review dimensions per the skill, but the PRD implies they are absent.

2. **Confidence Level field (section 7) is absent from the PRD**
   SKILL.md's Overall Assessment (§7) requires three sub-fields: Quality Score (1–10), Recommendation (Accept/Weak Accept/…/Reject), and **Confidence Level (High/Medium/Low)**. The PRD never mentions Confidence Level — not in FR-8, FR-9, UJ-2, or the section listing in Assumption A2. Any implementation derived from the PRD alone would produce an incomplete Overall Assessment section.

3. **UJ-2 counts seven sections but only enumerates six — Citation Suggestions is missing**
   UJ-2 states "seven structured sections" and then lists: Summary, Strengths, Detailed Review, Gaps, Suggestions, and an Overall Score — six items. **Section 6 (Citation Suggestions)** is omitted from the UJ-2 enumeration. Assumption A2 correctly lists all seven, but UJ-2 is internally inconsistent with both A2 and the SKILL.md, which treats Citation Suggestions as a top-level, mandatory section distinct from Suggestions.

**File path:** `/userworkqum/bisarkar/Fun/manuscript2presentation/.cursor/skills/ai-dm-paper-review/SKILL.md`
