import { getPane, truncateTitle } from "./dom";
import { activePaneForSelection } from "./selection-geometry";
import { session } from "./session";
import type { PaneSide } from "./types";

export function updateAddToLibraryButton(): void {
  for (const side of ["left", "right"] as const) {
    const add = document.getElementById(`btn-add-library-${side}`) as HTMLButtonElement | null;
    const rem = document.getElementById(`btn-remove-library-${side}`) as HTMLButtonElement | null;
    const on = Boolean(session.paneState[side].doc && session.paneState[side].storageId);
    if (add) add.disabled = !on;
    if (rem) rem.disabled = !on;
  }
}

export function syncNoteModeButton(): void {
  for (const side of ["left", "right"] as const) {
    const b = document.getElementById(`btn-note-${side}`) as HTMLButtonElement | null;
    if (b) b.setAttribute("aria-pressed", String(session.noteMode));
  }
  document.body.classList.toggle("note-mode", session.noteMode);
}

export function showToast(message: string, durationMs = 2000): void {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  window.setTimeout(() => {
    el.hidden = true;
  }, durationMs);
}

export function updateSelectionButtons(): void {
  const selSide = activePaneForSelection();
  const selText = window.getSelection()?.toString().trim() ?? "";
  for (const side of ["left", "right"] as const) {
    const copyBtn = document.getElementById(`btn-copy-${side}`) as HTMLButtonElement | null;
    const hlBtn = document.getElementById(`btn-highlight-${side}`) as HTMLButtonElement | null;
    const hasPdf = Boolean(session.paneState[side].doc);
    const hasSel = !session.noteMode && selSide === side && Boolean(selText);
    const dis = !hasPdf || session.noteMode || !hasSel;
    if (copyBtn) copyBtn.disabled = dis;
    if (hlBtn) hlBtn.disabled = dis;
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

export function updateHeaderSummary(): void {
  const countEl = document.getElementById("page-count")!;
  const titleEl = document.getElementById("doc-title")!;
  const L = session.paneState.left;
  const R = session.paneState.right;
  if (!L.doc && !R.doc) {
    countEl.textContent = "";
    titleEl.textContent = "No document";
    titleEl.removeAttribute("title");
    updateAddToLibraryButton();
    updateAnnotationChrome();
    return;
  }
  const leftTitle = L.doc ? (L.name || "").trim() || "Untitled" : "—";
  const rightTitle = R.doc ? (R.name || "").trim() || "Untitled" : "—";
  const display = `${leftTitle} | ${rightTitle}`;
  titleEl.textContent = display;
  titleEl.title = display;
  const leftP = L.doc ? `${L.doc.numPages}p` : "—";
  const rightP = R.doc ? `${R.doc.numPages}p` : "—";
  countEl.textContent = `${leftP} · ${rightP}`;
  updateAddToLibraryButton();
  updateAnnotationChrome();
}

export function updatePaneChrome(side: PaneSide): void {
  const p = getPane(side);
  const st = session.paneState[side];
  if (!st.doc) {
    session.paneLayoutSnapshot.delete(side);
    p.canvas.classList.add("hidden");
    p.canvasWrap.classList.remove("has-doc");
    p.highlightsLayer.replaceChildren();
    p.notesLayer.replaceChildren();
    p.textLayer.replaceChildren();
    p.pageInput.max = "1";
    p.pageInput.value = "1";
  } else {
    const n = st.doc.numPages;
    p.pageInput.max = String(n);
    const v = Math.min(Math.max(1, parseInt(p.pageInput.value, 10) || 1), n);
    p.pageInput.value = String(v);
    p.canvasWrap.classList.add("has-doc");
    p.canvas.classList.remove("hidden");
  }
  syncPaneDocLabel(side);
  const pPrintHl = document.getElementById(`btn-print-${side}-with-hl`) as HTMLButtonElement | null;
  const pPrintPlain = document.getElementById(`btn-print-${side}-without-hl`) as HTMLButtonElement | null;
  const hasDocForPrint = Boolean(st.doc);
  if (pPrintHl) pPrintHl.disabled = !hasDocForPrint;
  if (pPrintPlain) pPrintPlain.disabled = !hasDocForPrint;
}

export function syncPaneDocLabel(side: PaneSide): void {
  const p = getPane(side);
  const st = session.paneState[side];
  if (st.doc) {
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

export function docLabelForAnnotationDocId(docId: string): string {
  if (session.paneState.left.annotationDocId === docId) {
    return truncateTitle(session.paneState.left.name || "Left", 28);
  }
  if (session.paneState.right.annotationDocId === docId) {
    return truncateTitle(session.paneState.right.name || "Right", 28);
  }
  return "Document";
}
