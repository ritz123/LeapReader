import { getSelectionInViewport, activePaneForSelection, viewportAndPageFromSelection } from "./selection-geometry";
import { getHighlightColorPopover, session } from "./session";

export function updateSelectionFloatBar(): void {
  const el = document.getElementById("selection-float") as HTMLDivElement | null;
  if (!el) return;
  if (session.noteMode || !getHighlightColorPopover()?.hidden) {
    el.hidden = true;
    session.lastSelectionFloatSide = null;
    return;
  }
  const side = activePaneForSelection();
  if (!side || !session.paneState[side].doc) {
    el.hidden = true;
    session.lastSelectionFloatSide = null;
    return;
  }
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) {
    el.hidden = true;
    session.lastSelectionFloatSide = null;
    return;
  }
  const hit = viewportAndPageFromSelection(side);
  if (!hit) {
    el.hidden = true;
    session.lastSelectionFloatSide = null;
    return;
  }
  const range = getSelectionInViewport(hit.vp);
  if (!range) {
    el.hidden = true;
    session.lastSelectionFloatSide = null;
    return;
  }
  const rects = range.getClientRects();
  if (!rects.length) {
    el.hidden = true;
    session.lastSelectionFloatSide = null;
    return;
  }
  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]!;
    if (r.width < 1 && r.height < 1) continue;
    top = Math.min(top, r.top);
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  if (top === Infinity) {
    el.hidden = true;
    session.lastSelectionFloatSide = null;
    return;
  }
  session.lastSelectionFloatSide = side;
  el.hidden = false;
  const place = () => {
    const fw = el.offsetWidth || 220;
    const fh = el.offsetHeight || 40;
    let x = (left + right) / 2 - fw / 2;
    let y = top - fh - 10;
    x = Math.max(8, Math.min(x, window.innerWidth - fw - 8));
    y = Math.max(8, Math.min(y, window.innerHeight - fh - 8));
    if (y + fh > top - 4) y = Math.min(bottom + 10, window.innerHeight - fh - 8);
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
  };
  requestAnimationFrame(() => requestAnimationFrame(place));
}
