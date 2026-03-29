import { getPane } from "./dom";
import { session } from "./session";
import type { PaneSide } from "./types";

export function hideSelectionFloat(): void {
  const el = document.getElementById("selection-float");
  if (el) el.hidden = true;
  session.lastSelectionFloatSide = null;
}

export function activePaneForSelection(): PaneSide | null {
  const sel = window.getSelection();
  if (!sel?.anchorNode) return null;
  for (const side of ["left", "right"] as const) {
    const root = getPane(side).root;
    for (const vp of root.querySelectorAll<HTMLElement>(".page-viewport")) {
      if (vp.contains(sel.anchorNode)) return side;
    }
  }
  return null;
}

export function viewportAndPageFromSelection(
  side: PaneSide
): { vp: HTMLElement; pageNum: number } | null {
  const sel = window.getSelection();
  if (!sel?.anchorNode) return null;
  const root = getPane(side).root;
  const n = session.paneState[side].doc?.numPages ?? 1;
  for (const vp of root.querySelectorAll<HTMLElement>(".page-viewport")) {
    if (!vp.contains(sel.anchorNode)) continue;
    const slot = vp.closest<HTMLElement>("[data-pdf-page]");
    const pageNum = slot
      ? parseInt(slot.dataset.pdfPage ?? "1", 10)
      : Math.min(Math.max(1, parseInt(getPane(side).pageInput.value, 10) || 1), n);
    return { vp, pageNum };
  }
  return null;
}

export function rangeToFractionalRects(
  vpEl: HTMLElement,
  range: Range
): { l: number; t: number; w: number; h: number }[] | null {
  const cr = vpEl.getBoundingClientRect();
  if (cr.width < 1 || cr.height < 1) return null;
  const rects: { l: number; t: number; w: number; h: number }[] = [];
  for (const br of range.getClientRects()) {
    if (br.width < 2 && br.height < 2) continue;
    rects.push({
      l: (br.left - cr.left) / cr.width,
      t: (br.top - cr.top) / cr.height,
      w: br.width / cr.width,
      h: br.height / cr.height,
    });
  }
  return rects.length ? rects : null;
}

export function getSelectionInViewport(vpEl: HTMLElement): Range | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!vpEl.contains(range.commonAncestorContainer)) return null;
  return range;
}
