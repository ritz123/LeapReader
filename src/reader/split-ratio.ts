import { SPLIT_RATIO_STORAGE_KEY } from "./config";
import { isTabLayoutActive, readPaneModePref } from "./layout-controller";

const MIN_RATIO = 0.12;
const MAX_RATIO = 0.88;

/** Flex-grow values are applied to left (or top) and right (or bottom) panes. */
export function readSplitRatio(): number {
  const raw = localStorage.getItem(SPLIT_RATIO_STORAGE_KEY);
  const n = raw != null ? parseFloat(raw) : NaN;
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, n));
}

export function writeSplitRatio(ratio: number): void {
  const r = Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
  localStorage.setItem(SPLIT_RATIO_STORAGE_KEY, String(r));
}

/** Sets CSS variables on `#split` so pane widths/heights follow the saved ratio. */
export function applySplitRatioToDom(): void {
  const split = document.getElementById("split");
  if (!split) return;
  const r = readSplitRatio();
  split.style.setProperty("--split-primary-grow", String(r));
  split.style.setProperty("--split-secondary-grow", String(1 - r));
}

function splitUsesResizeCursor(): boolean {
  return window.matchMedia("(min-width: 600px) and (orientation: landscape)").matches;
}

function splitDragActive(): boolean {
  return readPaneModePref() === "split" && !isTabLayoutActive();
}

/**
 * Horizontal drag on landscape/desktop row layout; vertical drag when the split stacks.
 * No-op when tabs/single-pane layout hides the second pane.
 */
export function initSplitDivider(onFinishedDrag: () => void): void {
  const split = document.getElementById("split");
  const divider = split?.querySelector<HTMLElement>(".divider");
  if (!split || !divider) return;

  let dragging = false;

  divider.setAttribute("role", "separator");
  divider.setAttribute("tabindex", "0");
  divider.setAttribute("aria-orientation", "horizontal");

  const syncAriaOrientation = (): void => {
    // Row split: vertical bar between panes → separator orientation "vertical".
    divider.setAttribute("aria-orientation", splitUsesResizeCursor() ? "vertical" : "horizontal");
  };
  syncAriaOrientation();
  window.matchMedia("(min-width: 600px) and (orientation: landscape)").addEventListener("change", syncAriaOrientation);

  const applyOrientationClass = (): void => {
    divider.classList.toggle("divider--resize-row", splitUsesResizeCursor());
    divider.classList.toggle("divider--resize-col", !splitUsesResizeCursor());
  };
  applyOrientationClass();
  window.matchMedia("(min-width: 600px) and (orientation: landscape)").addEventListener("change", applyOrientationClass);

  const moveHandler = (e: MouseEvent): void => {
    if (!dragging || !splitDragActive()) return;
    const rect = split.getBoundingClientRect();
    let ratio: number;
    if (splitUsesResizeCursor()) {
      ratio = (e.clientX - rect.left) / Math.max(1, rect.width);
    } else {
      ratio = (e.clientY - rect.top) / Math.max(1, rect.height);
    }
    writeSplitRatio(ratio);
    applySplitRatioToDom();
  };

  const upHandler = (): void => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", moveHandler);
    window.removeEventListener("mouseup", upHandler);
    onFinishedDrag();
  };

  divider.addEventListener("mousedown", (e) => {
    if (!splitDragActive()) return;
    e.preventDefault();
    dragging = true;
    document.body.style.cursor = splitUsesResizeCursor() ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", moveHandler);
    window.addEventListener("mouseup", upHandler);
  });

  divider.addEventListener("keydown", (e) => {
    if (!splitDragActive()) return;
    const step = e.shiftKey ? 0.05 : 0.02;
    const row = splitUsesResizeCursor();
    let delta = 0;
    if (row) {
      if (e.key === "ArrowLeft") delta = -step;
      else if (e.key === "ArrowRight") delta = step;
    } else {
      if (e.key === "ArrowUp") delta = step;
      else if (e.key === "ArrowDown") delta = -step;
    }
    if (delta === 0) return;
    e.preventDefault();
    writeSplitRatio(readSplitRatio() + delta);
    applySplitRatioToDom();
    onFinishedDrag();
  });
}
