import type { PaneSide } from "./types";

const appMenuBtn = document.getElementById("btn-app-menu") as HTMLButtonElement | null;
const appMenuPanel = document.getElementById("app-menu-panel") as HTMLDivElement | null;
const appMenuBackdrop = document.getElementById("app-menu-backdrop") as HTMLDivElement | null;

export function setAppMenuOpen(open: boolean): void {
  appMenuBtn?.setAttribute("aria-expanded", String(open));
  if (appMenuPanel) appMenuPanel.hidden = !open;
  if (appMenuBackdrop) appMenuBackdrop.hidden = !open;
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

const librariesPanel = document.getElementById("libraries-panel");
const librariesIframe = document.getElementById("libraries-iframe") as HTMLIFrameElement | null;
const btnLibraries = document.getElementById("btn-libraries");

export function openLibrariesEmbed(): void {
  librariesPanel?.removeAttribute("hidden");
  librariesPanel?.setAttribute("aria-hidden", "false");
  btnLibraries?.setAttribute("aria-expanded", "true");
  document.body.classList.add("libraries-embed-active");
  librariesIframe?.focus({ preventScroll: true });
}

export function closeLibrariesEmbed(): void {
  if (!document.body.classList.contains("libraries-embed-active")) return;
  librariesPanel?.setAttribute("hidden", "");
  librariesPanel?.setAttribute("aria-hidden", "true");
  btnLibraries?.setAttribute("aria-expanded", "false");
  document.body.classList.remove("libraries-embed-active");
  btnLibraries?.focus();
}
