import { ZOOM_MAX, ZOOM_MIN } from "./config";
import { bumpContinuousRev } from "./continuous-helpers";
import { renderPane } from "./render-registry";
import { session } from "./session";
import type { PaneBaseFit, PaneSide } from "./types";

function clampPaneZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

export function syncZoomUi(side: PaneSide): void {
  const has = Boolean(session.paneState[side].doc);
  const z = session.paneZoomMultiplier[side];
  const pct = document.getElementById(`zoom-pct-${side}`);
  if (pct) pct.textContent = `${Math.round(z * 100)}%`;
  const inBtn = document.getElementById(`btn-zoom-in-${side}`) as HTMLButtonElement | null;
  const outBtn = document.getElementById(`btn-zoom-out-${side}`) as HTMLButtonElement | null;
  const fitBtn = document.getElementById(`btn-zoom-fit-${side}`) as HTMLButtonElement | null;
  const widthBtn = document.getElementById(`btn-zoom-width-${side}`) as HTMLButtonElement | null;
  if (inBtn) inBtn.disabled = !has || z >= ZOOM_MAX - 1e-6;
  if (outBtn) outBtn.disabled = !has || z <= ZOOM_MIN + 1e-6;
  if (fitBtn) fitBtn.disabled = !has;
  if (widthBtn) widthBtn.disabled = !has;
  syncFitModeUi(side);
}

export function syncFitModeUi(side: PaneSide): void {
  const fitBtn = document.getElementById(`btn-zoom-fit-${side}`) as HTMLButtonElement | null;
  const widthBtn = document.getElementById(`btn-zoom-width-${side}`) as HTMLButtonElement | null;
  const mode = session.paneBaseFit[side];
  if (fitBtn) fitBtn.setAttribute("aria-pressed", String(mode === "page"));
  if (widthBtn) widthBtn.setAttribute("aria-pressed", String(mode === "width"));
}

export function adjustPaneZoom(side: PaneSide, factor: number): void {
  if (!session.paneState[side].doc) return;
  session.paneZoomMultiplier[side] = clampPaneZoom(session.paneZoomMultiplier[side] * factor);
  session.paneLayoutSnapshot.delete(side);
  if (session.paneScrollMode[side] === "continuous") bumpContinuousRev(side);
  void renderPane(side);
}

export function setPaneBaseFit(side: PaneSide, fit: PaneBaseFit): void {
  if (!session.paneState[side].doc) return;
  session.paneBaseFit[side] = fit;
  session.paneZoomMultiplier[side] = 1;
  session.paneLayoutSnapshot.delete(side);
  if (session.paneScrollMode[side] === "continuous") bumpContinuousRev(side);
  void renderPane(side);
}
