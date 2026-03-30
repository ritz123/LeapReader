/**
 * Chrome-toolbar: keeps all visible UI chrome in sync with session state.
 *
 * Responsibilities (each function has exactly one):
 *   updatePaneChrome   — per-pane placeholder / has-doc / page-input
 *   syncPaneDocLabel   — floating document-name label
 *   updateNavDisabled  — prev/next button disabled state
 *   updateHeaderSummary— global title bar and page-count badge
 *   updateAddToLibraryButton — library action buttons
 *   updateAnnotationChrome   — note/marks/copy/highlight disabled state
 *   updateSelectionButtons   — copy/highlight enable based on active selection
 *   syncNoteModeButton — note-mode aria-pressed + body class
 *   docLabelForAnnotationDocId — helper for note dialog labels
 *
 * Call initChromeListeners() once from bootstrapReader() to wire the event
 * bus so chrome updates fire automatically on every pane state change.
 */

import { getPane, truncateTitle } from "./dom";
import { onPaneDocChanged } from "./pane-events";
import { activePaneForSelection } from "./selection-geometry";
import { session } from "./session";
export { showToast } from "./toast";
import type { PaneSide } from "./types";

// ── Per-pane chrome ───────────────────────────────────────────────────────────

export function updatePaneChrome(side: PaneSide): void {
  const p = getPane(side);
  const st = session.paneState[side];
  const hasContent = Boolean(st.doc || st.docHtml);

  // Placeholder: directly managed via hidden attribute (not CSS class) so
  // the display:flex rule on .placeholder never fights [hidden].
  p.placeholder.hidden = hasContent;

  if (!hasContent) {
    session.paneLayoutSnapshot.delete(side);
    p.canvas.classList.add("hidden");
    p.canvasWrap.classList.remove("has-doc");
    p.highlightsLayer.replaceChildren();
    p.notesLayer.replaceChildren();
    p.textLayer.replaceChildren();
    p.pageInput.max = "1";
    p.pageInput.value = "1";
  } else if (st.docHtml) {
    p.canvasWrap.classList.add("has-doc");
  } else if (st.doc) {
    const n = st.doc.numPages;
    p.pageInput.max = String(n);
    const v = Math.min(Math.max(1, parseInt(p.pageInput.value, 10) || 1), n);
    p.pageInput.value = String(v);
    p.canvasWrap.classList.add("has-doc");
    p.canvas.classList.remove("hidden");
  }

  syncPaneDocLabel(side);

  const printHlBtn = document.getElementById(`btn-print-${side}-with-hl`) as HTMLButtonElement | null;
  const printPlainBtn = document.getElementById(`btn-print-${side}-without-hl`) as HTMLButtonElement | null;
  const hasPdf = Boolean(st.doc);
  if (printHlBtn) printHlBtn.disabled = !hasPdf;
  if (printPlainBtn) printPlainBtn.disabled = !hasPdf;

  const textOptsGroup = document.getElementById(`pane-text-opts-${side}`) as HTMLElement | null;
  if (textOptsGroup) textOptsGroup.hidden = st.docType !== "txt";
}

export function syncPaneDocLabel(side: PaneSide): void {
  const p = getPane(side);
  const st = session.paneState[side];
  if (st.doc || st.docHtml) {
    p.docNameEl.textContent = st.name;
    p.docNameEl.classList.remove("pane-doc-name--empty");
    p.docNameEl.title = st.name;
  } else {
    p.docNameEl.textContent = "No document";
    p.docNameEl.classList.add("pane-doc-name--empty");
    p.docNameEl.removeAttribute("title");
  }
}

export function updateNavDisabled(): void {
  for (const side of ["left", "right"] as const) {
    const d = session.paneState[side].doc;
    const p = getPane(side);
    if (!d) {
      p.prevBtn.disabled = true;
      p.nextBtn.disabled = true;
      continue;
    }
    const n = d.numPages;
    const page = Math.min(Math.max(1, parseInt(p.pageInput.value, 10) || 1), n);
    p.prevBtn.disabled = page <= 1;
    p.nextBtn.disabled = page >= n;
  }
}

// ── Global header ─────────────────────────────────────────────────────────────

/** Updates the toolbar title bar and page-count badge only. */
export function updateHeaderSummary(): void {
  const countEl = document.getElementById("page-count")!;
  const titleEl = document.getElementById("doc-title")!;
  const L = session.paneState.left;
  const R = session.paneState.right;

  if (!L.doc && !L.docHtml && !R.doc && !R.docHtml) {
    countEl.textContent = "";
    titleEl.textContent = "No document";
    titleEl.removeAttribute("title");
    return;
  }

  const leftTitle = (L.doc || L.docHtml) ? (L.name || "").trim() || "Untitled" : "—";
  const rightTitle = (R.doc || R.docHtml) ? (R.name || "").trim() || "Untitled" : "—";
  const display = `${leftTitle} | ${rightTitle}`;
  titleEl.textContent = display;
  titleEl.title = display;

  const leftP = L.doc ? `${L.doc.numPages}p` : "—";
  const rightP = R.doc ? `${R.doc.numPages}p` : "—";
  countEl.textContent = `${leftP} · ${rightP}`;
}

// ── Library chrome ────────────────────────────────────────────────────────────

export function updateAddToLibraryButton(): void {
  for (const side of ["left", "right"] as const) {
    const add = document.getElementById(`btn-add-library-${side}`) as HTMLButtonElement | null;
    const rem = document.getElementById(`btn-remove-library-${side}`) as HTMLButtonElement | null;
    // Library actions require a known storage ID; currently only available for PDF documents.
    const on = Boolean(session.paneState[side].doc && session.paneState[side].storageId);
    if (add) add.disabled = !on;
    if (rem) rem.disabled = !on;
  }
}

// ── Annotation / selection chrome ─────────────────────────────────────────────

export function updateSelectionButtons(): void {
  const selSide = activePaneForSelection();
  const selText = window.getSelection()?.toString().trim() ?? "";
  for (const side of ["left", "right"] as const) {
    const copyBtn = document.getElementById(`btn-copy-${side}`) as HTMLButtonElement | null;
    const hlBtn = document.getElementById(`btn-highlight-${side}`) as HTMLButtonElement | null;
    const hasPdf = Boolean(session.paneState[side].doc);
    const hasSel = !session.noteMode && selSide === side && Boolean(selText);
    const disabled = !hasPdf || session.noteMode || !hasSel;
    if (copyBtn) copyBtn.disabled = disabled;
    if (hlBtn) hlBtn.disabled = disabled;
  }
}

export function updateAnnotationChrome(): void {
  for (const side of ["left", "right"] as const) {
    const hasDoc = Boolean(session.paneState[side].doc);
    const noteBtn = document.getElementById(`btn-note-${side}`) as HTMLButtonElement | null;
    const listBtn = document.getElementById(`btn-marks-${side}`) as HTMLButtonElement | null;
    if (noteBtn) noteBtn.disabled = !hasDoc;
    if (listBtn) listBtn.disabled = false;
  }
  updateSelectionButtons();
}

export function syncNoteModeButton(): void {
  for (const side of ["left", "right"] as const) {
    const b = document.getElementById(`btn-note-${side}`) as HTMLButtonElement | null;
    if (b) b.setAttribute("aria-pressed", String(session.noteMode));
  }
  document.body.classList.toggle("note-mode", session.noteMode);
}

// ── Utility ───────────────────────────────────────────────────────────────────

export function docLabelForAnnotationDocId(docId: string): string {
  if (session.paneState.left.annotationDocId === docId) {
    return truncateTitle(session.paneState.left.name || "Left", 28);
  }
  if (session.paneState.right.annotationDocId === docId) {
    return truncateTitle(session.paneState.right.name || "Right", 28);
  }
  return "Document";
}

// ── Event-bus wiring ──────────────────────────────────────────────────────────

/**
 * Register subscriptions so chrome updates fire automatically whenever a
 * pane's document state changes.
 *
 * Call once from bootstrapReader(). Each handler has a single responsibility
 * — adding a new chrome concern means adding one new onPaneDocChanged call here
 * without touching any of the state-mutation modules (Open/Closed principle).
 */
export function initChromeListeners(): void {
  // Per-pane chrome: placeholder, has-doc class, page input, doc name label.
  onPaneDocChanged((side) => updatePaneChrome(side));

  // Global header: title bar and page-count badge.
  onPaneDocChanged(() => updateHeaderSummary());

  // Library action buttons (Add / Remove from library).
  onPaneDocChanged(() => updateAddToLibraryButton());

  // Annotation chrome: note/marks/copy/highlight buttons.
  onPaneDocChanged(() => updateAnnotationChrome());

  // Nav buttons: prev/next disabled state after doc load/clear.
  onPaneDocChanged(() => updateNavDisabled());
}
