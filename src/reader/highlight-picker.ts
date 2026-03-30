import {
  type HighlightColorId,
  isHighlightColorId,
} from "../highlight-colors";
import * as storage from "../storage";
import { LAST_HIGHLIGHT_COLOR_KEY } from "./config";
import { paintAnnotations } from "./annotations-paint";
import { showToast, updateSelectionButtons } from "./chrome-toolbar";
import {
  getSelectionInViewport,
  hideSelectionFloat,
  rangeToFractionalRects,
  viewportAndPageFromSelection,
} from "./selection-geometry";
import { updateSelectionFloatBar } from "./selection-float-bar";
import { getHighlightColorPopover, session } from "./session";
import type { PaneSide } from "./types";

export function buildPendingHighlightFromSelection(side: PaneSide): boolean {
  const st = session.paneState[side];
  if (!st.doc || !st.annotationDocId) return false;
  const hit = viewportAndPageFromSelection(side);
  if (!hit) return false;
  const range = getSelectionInViewport(hit.vp);
  if (!range) return false;
  const rects = rangeToFractionalRects(hit.vp, range);
  if (!rects) return false;
  const quote = (window.getSelection()?.toString() ?? "").slice(0, 4000);
  session.pendingHighlight = {
    side,
    pageNum: hit.pageNum,
    rects,
    quote,
    annotationDocId: st.annotationDocId,
  };
  return true;
}

export async function quickHighlightLastColor(side: PaneSide): Promise<void> {
  if (!buildPendingHighlightFromSelection(side)) return;
  let color: HighlightColorId = "yellow";
  try {
    const last = localStorage.getItem(LAST_HIGHLIGHT_COLOR_KEY);
    if (last && isHighlightColorId(last)) color = last;
  } catch {
    /* ignore */
  }
  await commitHighlightWithColor(color);
}

export function closeHighlightColorPopover(): void {
  session.pendingHighlight = null;
  session.highlightPopoverAnchorEl = null;
  const pop = getHighlightColorPopover();
  if (pop) {
    pop.hidden = true;
    pop.style.left = "";
    pop.style.top = "";
  }
  updateSelectionFloatBar();
}

export function positionHighlightColorPopover(anchor: HTMLElement): void {
  const pop = getHighlightColorPopover();
  if (!pop) return;
  const r = anchor.getBoundingClientRect();
  const pad = 8;
  const pw = pop.offsetWidth || 220;
  const ph = pop.offsetHeight || 120;
  let left = r.left + r.width / 2 - pw / 2;
  let top = r.bottom + pad;
  left = Math.max(pad, Math.min(left, window.innerWidth - pw - pad));
  if (top + ph > window.innerHeight - pad) {
    top = Math.max(pad, r.top - ph - pad);
  }
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
}

export function openHighlightColorChooser(side: PaneSide, anchorEl: HTMLElement | null = null): void {
  if (!buildPendingHighlightFromSelection(side)) return;
  const pop = getHighlightColorPopover();
  if (!pop) return;
  pop.hidden = false;
  const anchor =
    anchorEl ??
    (document.getElementById(`pane-tools-${side}`) as HTMLElement | null) ??
    (document.getElementById(`btn-highlight-${side}`) as HTMLElement | null);
  session.highlightPopoverAnchorEl = anchor;
  if (anchor) {
    requestAnimationFrame(() => {
      positionHighlightColorPopover(anchor);
      hideSelectionFloat();
      let focusSwatch: HTMLButtonElement | null = null;
      try {
        const last = localStorage.getItem(LAST_HIGHLIGHT_COLOR_KEY);
        if (last && isHighlightColorId(last)) {
          focusSwatch =
            getHighlightColorPopover()?.querySelector<HTMLButtonElement>(`[data-hl-color="${last}"]`) ??
            null;
        }
      } catch {
        /* ignore */
      }
      (focusSwatch ?? getHighlightColorPopover()?.querySelector<HTMLButtonElement>(".highlight-swatch"))?.focus();
    });
  } else {
    hideSelectionFloat();
  }
}

export async function commitHighlightWithColor(colorId: HighlightColorId): Promise<void> {
  const ph = session.pendingHighlight;
  if (!ph) return;
  session.pendingHighlight = null;
  closeHighlightColorPopover();
  try {
    localStorage.setItem(LAST_HIGHLIGHT_COLOR_KEY, colorId);
  } catch {
    /* ignore */
  }
  await storage.putAnnotation({
    id: crypto.randomUUID(),
    docId: ph.annotationDocId,
    pane: ph.side,
    page: ph.pageNum,
    kind: "highlight",
    createdAt: Date.now(),
    rects: ph.rects,
    color: colorId,
    quote: ph.quote,
  });
  window.getSelection()?.removeAllRanges();
  await paintAnnotations(ph.side, ph.pageNum);
  showToast("Highlight saved");
  updateSelectionButtons();
}
