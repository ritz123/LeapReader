# PRD Quality Review — LeapReader LLM Integration

## Overall verdict

The PRD is substantially solid: assumption-tagged, FR-numbered, and consequence-testable throughout. However it has one hard implementation blocker (Python bundling strategy unresolved), one hidden v1 scope gap ("Review offline" ships without an FR), one almost-certainly wrong NFR (≤50 MB bundled Python overhead), and a contradiction between UJ-1's latency claim and SM-2's success metric. Fix these before handing off to implementation.

---

## Decision-readiness — Conditional pass

**Blocker.** OQ-2 (Python bundling: `uv`-venv vs. PyInstaller) is explicitly labelled "Decide before implementation" and left open. This choice affects build pipeline, CI/CD, installer size, code-signing, and debugging workflow — it cannot be deferred to architecture. It should either be resolved here or escalated to a named decision owner with a deadline.

**Blocker.** OQ-3 (Ollama binary download URL strategy — pin version vs. always-latest) is unresolved and has security and reproducibility implications. Pinning a specific Ollama version (or committing to a minimum) is necessary for the installer size claim and for test reproducibility.

**Minor gap.** OQ-7 says tool-call/model compatibility "needs to be defined in implementation," but FR-8 already specifies the fallback behavior (non-tool prompt + warning banner). The inconsistency between the body and the open-questions section may mislead an implementor into thinking the fallback is still underspecified.

**Well done.** All other decisions that could block an architect are resolved in §11 with cross-references to the relevant FRs.

---

## Substance over theater — Pass with two flags

**Flag 1 (metric contradiction).** SM-2 specifies ≤45 seconds wall-clock for a 20-page summary. UJ-1 describes "Within 20–30 seconds." These are the same scenario (one summarization on a mid-range laptop) and the numbers disagree. One of them is theater. Pick one and remove the other, or scope them differently (e.g., SM-2 is the SLO; UJ-1 is the aspirational UX narrative).

**Flag 2 (unverifiable self-report).** SM-1 ("Summarize used ≥ 3 times per week by the developer") is a self-reported personal habit target. It cannot be instrumented without telemetry (which SM-C2 explicitly forbids) and is unverifiable by any other stakeholder. Acceptable for a personal tool but worth flagging as unfalsifiable.

**Well done.** Every FR has "Consequences (testable)" with specific, binary-checkable outcomes. NFRs carry real numbers (3 s first token, 50 MB installer delta, 100 MB idle RAM). This is far above average for a solo-developer PRD.

---

## Strategic coherence — Pass with one note

**Note.** The vision promises "no manual setup beyond installing the app." FR-13's first-run flow involves downloading a ~100+ MB Ollama binary and then a ~2.0 GB model before any AI feature works. This is technically "automatic" but the user experience is a multi-gigabyte wait — which could feel like significant "setup" to a first-time user. The PRD's UJ-1 does not address this first-run experience (the user in UJ-1 immediately clicks Summarize; there is no UJ for "first run, model not yet downloaded"). The gap between promise and experience should be acknowledged and a first-run UJ added, or the vision statement should be softened slightly.

**Well done.** Pane-bound context is internally consistent throughout vision → glossary → FRs → NFRs → non-goals. The privacy model (three-category network call taxonomy in NFR-4) is specific and coherent.

---

## Done-ness clarity — Conditional pass

**Significant gap.** "Review (offline)" is confirmed as a v1 deliverable (A12, FR-8 notes) — the same section that defines FR-8 — but it has no FR of its own, no testable consequences, and no UI specification. A developer cannot determine whether this feature is "done." It should be given an FR (FR-19 or a sub-FR of FR-8) with at least one consequence.

**Minor gap.** FR-15 says the Model Browser lets the user "search for and pull any model available in the Ollama registry," but the consequence says "the user can enter any valid Ollama model tag." Ollama does not have a public search API; there is no searchable catalog in the app. "Search for" implies browsing/filtering capability that is not specified. Clarify whether this is a free-text tag-entry field or a searchable list (and if the latter, where the catalog data comes from).

**Minor gap.** FR-9 says tool-call status lines "collapse once streaming begins" but does not specify the collapse mechanism: auto-collapse, animated fold, or hidden permanently? A QA engineer cannot test "collapses" without a UI spec.

**Minor gap.** The `localStorage` key for the selected model is not specified (FR-15 says persistence occurs but gives no key name, unlike FR-1 which names `leapReaderAIPanelLeft/Right`).

**Well done.** The FR consequence pattern is consistently applied and produces genuinely testable acceptance criteria throughout §4.

---

## Scope honesty — Flag required

**Likely-wrong NFR.** NFR-11 states the bundled Python environment must not increase the installer by more than 50 MB. The specified dependency stack (FastAPI + uvicorn + ollama client + pypdf + duckduckgo-search + requests + their transitive dependencies) in a `uv`-managed venv will substantially exceed 50 MB on all three target platforms. A PyInstaller bundle would be 150–300 MB. This NFR needs to be validated against an actual package audit before being committed as a requirement; otherwise it will silently fail and create a late-stage conflict.

**Hidden scope.** As noted under Done-ness, "Review offline" is v1 scope without estimation. Even as a secondary action, it requires backend routing logic, a UI affordance (long-press or dropdown), and a test case.

**Well done.** §5 and §6.2 are specific and credible. The `[NOTE FOR PM: …]` annotations on deferred items (cross-pane context, export chat) are useful signals for prioritization.

---

## Downstream usability — Pass with two gaps

**Gap 1 (prompt by reference).** FR-8 specifies the review system prompt as "adapted from `ai-dm-paper-review/SKILL.md`" — a file path to the developer's personal skill library. A future contributor or the architecture document cannot use this reference without access to that file. The prompt should either be reproduced verbatim in an appendix or in `extraResources`, or the FR should state the exact sections/headings the prompt must produce so any prompt achieving that output would satisfy the requirement.

**Gap 2 (IPC contract).** FR-8 mentions the PDF file path is passed "from Electron to the Python backend via IPC" but the IPC message schema is not specified. This is acceptable as a PRD (the architecture doc will specify it), but the PRD should at least note that the IPC contract is downstream architecture work, not leave it implicit.

**Well done.** The Glossary is thorough and used consistently. The three-category privacy taxonomy (NFR-4) is directly actionable for writing the Help dialog copy. FR numbering is globally stable and cross-referenced in §6.1 and §11.

---

## Shape fit — Pass

For a medium-stakes solo-developer public-release PRD, the document is appropriately sized. The assumption-tagging system is a genuine strength that compresses many decisions into a scannable §11 index. The "Consequences (testable)" pattern within each FR is a good match for a project that has no dedicated QA team — the developer can self-test against them.

The UJ narratives are more elaborate than strictly necessary for a one-person project (four named characters, detailed edge cases), but they serve as useful regression anchors for UX decisions and do not add confusion.

---

## Mechanical notes

**Glossary drift.**
- `Page Extraction` is defined in the Glossary but never used in any FR body. FR-4 and FR-6 use "pdfjs text layer" and "pdfjs text layer (Pane Context)" instead. Either use the defined term or remove it from the Glossary.
- `Shortcut Button` is defined in the Glossary (capitalized) but FR-6, FR-8, and §6.1 use "shortcut button" (lowercase) inconsistently. Minor, but worth standardizing.

**ID continuity.**
- A6 and A6a exist side-by-side in §11. The `a`-suffix signals a late addition. This is cosmetically awkward; consider renumbering A6a → A13 and updating the one inline tag (FR-4).
- OQ-1 appears only as `[OQ-1 resolved]` inside FR-10's body — it does not appear in §10 at all. The §10 questions (OQ-2 through OQ-7) are not labelled with OQ- IDs in §10 itself. Add OQ- labels to the §10 list entries for traceability.

**Assumptions Index roundtrip.**
- OQ-6 in §10 contains an inline assumption tag (`[ASSUMPTION: ~30% of pane height, resizable via drag handle]`) but this assumption has no A-number and is absent from §11. It is an unindexed ghost assumption. Assign it an ID (A13 or A14) and add it to §11.
- A2 claims the review output has "7 top-level sections (Summary, Strengths, Detailed Review with 8 subsections, Gaps, Suggestions, Citation Suggestions, Overall Assessment)." FR-8 lists the review prompt sections as a flat 13-item enumeration (Summary, Strengths, Technical Correctness, Consistency, Clarity, Research Integrity, Citations, Authenticity, Novelty, Fit for Venue, Gaps, Suggestions, Overall Score). The two counts and structures do not match. Reconcile FR-8's flat list with A2's 7-section hierarchy and make FR-9's "7 top-level sections" consequence unambiguous.

**UJ protagonist naming.**
- UJ-4's protagonist is named "Dev." In a developer-authored document, this name collides semantically with "developer" (the author/implementor). Recommend renaming to avoid accidental ambiguity in future contributor conversations (e.g., "Dev should see…" could mean the UJ protagonist or the implementor).
