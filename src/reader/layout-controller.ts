import {
  LAYOUT_STORAGE_KEY,
  NARROW_MAX_PX,
  PANE_MODE_STORAGE_KEY,
} from "./config";
import { notifyAfterLayoutChange } from "./lifecycle";
import type { PaneSide } from "./types";

export function isNarrowViewport(): boolean {
  return window.matchMedia(`(max-width: ${NARROW_MAX_PX}px)`).matches;
}

export function readLayoutPref(): "split" | "tabs" {
  return localStorage.getItem(LAYOUT_STORAGE_KEY) === "tabs" ? "tabs" : "split";
}

export function writeLayoutPref(mode: "split" | "tabs"): void {
  localStorage.setItem(LAYOUT_STORAGE_KEY, mode);
}

export function readPaneModePref(): "single" | "split" {
  return localStorage.getItem(PANE_MODE_STORAGE_KEY) === "split" ? "split" : "single";
}

export function writePaneModePref(mode: "single" | "split"): void {
  localStorage.setItem(PANE_MODE_STORAGE_KEY, mode);
}

export function getSplitRoot(): HTMLElement {
  return document.getElementById("split")!;
}

/** True when only one pane is visible (narrow tabs, or single-pane mode at any width). */
export function isTabLayoutActive(): boolean {
  return (
    document.body.classList.contains("layout-tabs") ||
    document.body.classList.contains("layout-one-pane")
  );
}

export function getActivePaneTab(): PaneSide {
  const v = getSplitRoot().dataset.activeTab;
  return v === "right" ? "right" : "left";
}

export function syncLayoutSegmentButtons(mode: "split" | "tabs"): void {
  document.querySelectorAll<HTMLButtonElement>(".btn-seg[data-layout]").forEach((btn) => {
    const m = btn.dataset.layout as "split" | "tabs";
    btn.setAttribute("aria-pressed", String(m === mode));
  });
}

export function syncPaneModeButtons(mode: "single" | "split"): void {
  document.querySelectorAll<HTMLButtonElement>(".btn-seg[data-pane-mode]").forEach((btn) => {
    const m = btn.dataset.paneMode as "single" | "split";
    btn.setAttribute("aria-pressed", String(m === mode));
  });
}

export function syncPaneTabButtons(side: PaneSide): void {
  document.querySelectorAll<HTMLButtonElement>(".btn-tab[data-pane-tab]").forEach((btn) => {
    const t = btn.dataset.paneTab as PaneSide;
    btn.setAttribute("aria-selected", String(t === side));
  });
}

export function setActivePaneTab(side: PaneSide): void {
  getSplitRoot().dataset.activeTab = side;
  syncPaneTabButtons(side);
}

export function applyLayoutForViewport(): void {
  const paneMode = readPaneModePref();
  syncPaneModeButtons(paneMode);

  if (paneMode === "single") {
    document.body.classList.add("layout-one-pane");
    document.body.classList.remove("layout-tabs");
    return;
  }

  document.body.classList.remove("layout-one-pane");

  const narrow = isNarrowViewport();
  if (!narrow) {
    document.body.classList.remove("layout-tabs");
    syncLayoutSegmentButtons("split");
    return;
  }
  const pref = readLayoutPref();
  if (pref === "tabs") {
    document.body.classList.add("layout-tabs");
    syncLayoutSegmentButtons("tabs");
  } else {
    document.body.classList.remove("layout-tabs");
    syncLayoutSegmentButtons("split");
  }
}

export interface LayoutRuntime {
  hasAnyOpenDocument: () => boolean;
  invalidatePaneMeasures: () => void;
  closeAppMenu: () => void;
  waitLayout: () => Promise<void>;
}

export function runSetPaneMode(mode: "single" | "split", rt: LayoutRuntime): void {
  writePaneModePref(mode);
  applyLayoutForViewport();
  if (rt.hasAnyOpenDocument()) {
    rt.invalidatePaneMeasures();
  }
  rt.closeAppMenu();
  void rt.waitLayout().then(() => notifyAfterLayoutChange());
}

export function runSetLayoutMode(mode: "split" | "tabs", rt: LayoutRuntime): void {
  writeLayoutPref(mode);
  if (rt.hasAnyOpenDocument()) {
    rt.invalidatePaneMeasures();
  }
  if (readPaneModePref() === "single") {
    applyLayoutForViewport();
    syncLayoutSegmentButtons(mode);
  } else if (!isNarrowViewport()) {
    document.body.classList.remove("layout-tabs");
    syncLayoutSegmentButtons("split");
  } else if (mode === "tabs") {
    document.body.classList.add("layout-tabs");
    syncLayoutSegmentButtons("tabs");
  } else {
    document.body.classList.remove("layout-tabs");
    syncLayoutSegmentButtons("split");
  }
  rt.closeAppMenu();
  if (rt.hasAnyOpenDocument()) void rt.waitLayout().then(() => notifyAfterLayoutChange());
}
