import { session } from "./session";
import type { PaneSide } from "./types";

export const PAGE_FRAME_ASPECT_KEY_PREFIX = "leapReaderPageFrameAspect-";

/**
 * Largest axis-aligned rectangle with aspect ratio `frameAspect` (width ÷ height)
 * inside an outer box of size (availW, availH), after uniform padding slack.
 */
export function insetMaxBoxForFrameAspect(
  availW: number,
  availH: number,
  frameAspect: number | null,
  outerPadPx: number
): { maxW: number; maxH: number } {
  const innerW = Math.max(100, availW - outerPadPx);
  const innerH = Math.max(100, availH - outerPadPx);
  if (frameAspect == null || !(frameAspect > 0)) {
    return { maxW: innerW, maxH: innerH };
  }
  let bw = innerW;
  let bh = bw / frameAspect;
  if (bh > innerH) {
    bh = innerH;
    bw = bh * frameAspect;
  }
  return { maxW: bw, maxH: bh };
}

export function getPdfFitBoxForPane(side: PaneSide, wrapEl: HTMLElement): { maxW: number; maxH: number } {
  return insetMaxBoxForFrameAspect(
    wrapEl.clientWidth,
    wrapEl.clientHeight,
    session.panePageFrameAspect[side],
    16
  );
}

export function readStoredPageFrameAspect(side: PaneSide): number | null {
  const v = localStorage.getItem(`${PAGE_FRAME_ASPECT_KEY_PREFIX}${side}`);
  if (!v || v === "auto") return null;
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function writeStoredPageFrameAspect(side: PaneSide, aspect: number | null): void {
  const key = `${PAGE_FRAME_ASPECT_KEY_PREFIX}${side}`;
  if (aspect == null) localStorage.removeItem(key);
  else localStorage.setItem(key, String(aspect));
}

export function loadPageFrameAspectsIntoSession(): void {
  session.panePageFrameAspect.left = readStoredPageFrameAspect("left");
  session.panePageFrameAspect.right = readStoredPageFrameAspect("right");
}

/** Sync the Page frame dropdown to `session` (call after loading prefs). */
export function syncPageFrameSelect(side: PaneSide): void {
  const sel = document.getElementById(`page-frame-${side}`) as HTMLSelectElement | null;
  if (!sel) return;
  const a = session.panePageFrameAspect[side];
  if (a == null) {
    sel.value = "";
    return;
  }
  const match = Array.from(sel.options).find((o) => {
    if (!o.value) return false;
    const n = parseFloat(o.value);
    return Number.isFinite(n) && Math.abs(n - a) < 1e-4;
  });
  sel.value = match?.value ?? "";
}
