/**
 * Open/close helpers for the app menu flyout, per-pane tool flyouts, and the
 * libraries embed panel.
 *
 * DOM references are resolved inside each function (not at module load) so
 * this module is safe to import before the DOM is ready and does not hold
 * stale references if elements are ever re-stamped.
 */

import type { PaneSide } from "./types";

export function setAppMenuOpen(open: boolean): void {
  const btn = document.getElementById("btn-app-menu");
  const panel = document.getElementById("app-menu-panel") as HTMLElement | null;
  const backdrop = document.getElementById("app-menu-backdrop") as HTMLElement | null;
  btn?.setAttribute("aria-expanded", String(open));
  if (panel) panel.hidden = !open;
  if (backdrop) backdrop.hidden = !open;
}

export function closeAllPaneFlyouts(): void {
  for (const side of ["left", "right"] as const) {
    document.getElementById(`pane-flyout-${side}`)?.setAttribute("hidden", "");
    document.getElementById(`pane-flyout-backdrop-${side}`)?.setAttribute("hidden", "");
    document.getElementById(`pane-tools-${side}`)?.setAttribute("aria-expanded", "false");
  }
}

export function togglePaneToolsFlyout(side: PaneSide): void {
  const fly = document.getElementById(`pane-flyout-${side}`) as HTMLElement | null;
  const wasOpen = fly != null && !fly.hidden;
  closeAllPaneFlyouts();
  if (!wasOpen && fly) {
    fly.removeAttribute("hidden");
    document.getElementById(`pane-flyout-backdrop-${side}`)?.removeAttribute("hidden");
    document.getElementById(`pane-tools-${side}`)?.setAttribute("aria-expanded", "true");
  }
}

export function openLibrariesEmbed(): void {
  const panel = document.getElementById("libraries-panel");
  const iframe = document.getElementById("libraries-iframe") as HTMLIFrameElement | null;
  const btn = document.getElementById("btn-libraries");
  panel?.removeAttribute("hidden");
  panel?.setAttribute("aria-hidden", "false");
  btn?.setAttribute("aria-expanded", "true");
  document.body.classList.add("libraries-embed-active");
  iframe?.focus({ preventScroll: true });
}

export function closeLibrariesEmbed(): void {
  if (!document.body.classList.contains("libraries-embed-active")) return;
  const panel = document.getElementById("libraries-panel");
  const btn = document.getElementById("btn-libraries");
  panel?.setAttribute("hidden", "");
  panel?.setAttribute("aria-hidden", "true");
  btn?.setAttribute("aria-expanded", "false");
  document.body.classList.remove("libraries-embed-active");
  btn?.focus();
}
