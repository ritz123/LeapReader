import { updateNavDisabled } from "./chrome-toolbar";
import { getPane } from "./dom";
import { scrollContinuousToPage } from "./pdf-continuous";
import { renderPane } from "./render-registry";
import { session } from "./session";
import type { PaneSide } from "./types";

/** Jump to a 1-based page in the given pane (single-page or continuous scroll). */
export function goToPdfPage(side: PaneSide, pageNum: number): void {
  const p = getPane(side);
  const doc = session.paneState[side].doc;
  if (!doc) return;
  const n = doc.numPages;
  const v = Math.min(Math.max(1, Math.round(pageNum)), n);
  p.pageInput.value = String(v);
  if (session.paneScrollMode[side] === "continuous") {
    scrollContinuousToPage(side, v);
    updateNavDisabled();
    return;
  }
  void renderPane(side);
}
