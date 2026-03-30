import type { PaneElements, PaneSide } from "./types";

export function waitLayout(): Promise<void> {
  return new Promise<void>((r) =>
    requestAnimationFrame(() => requestAnimationFrame(() => r()))
  );
}

export function truncateTitle(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

export function getPane(side: PaneSide): PaneElements {
  const root = document.querySelector<HTMLElement>(`.pane[data-side="${side}"]`)!;
  const singlePageShell = root.querySelector<HTMLElement>(".single-page-shell")!;
  const continuousStack = root.querySelector<HTMLElement>(".continuous-stack")!;
  const pageViewport = singlePageShell.querySelector<HTMLElement>(".page-viewport")!;
  return {
    root,
    singlePageShell,
    continuousStack,
    pageViewport,
    canvas: pageViewport.querySelector<HTMLCanvasElement>(".pdf-canvas")!,
    textLayer: pageViewport.querySelector<HTMLElement>(".text-layer")!,
    highlightsLayer: pageViewport.querySelector<HTMLElement>(".annotation-highlights")!,
    notesLayer: pageViewport.querySelector<HTMLElement>(".annotation-notes")!,
    pageInput: root.querySelector<HTMLInputElement>(".page-input")!,
    prevBtn: root.querySelector<HTMLButtonElement>('[data-action="prev"]')!,
    nextBtn: root.querySelector<HTMLButtonElement>('[data-action="next"]')!,
    canvasWrap: root.querySelector<HTMLElement>(".canvas-wrap")!,
    canvasScroll: root.querySelector<HTMLElement>(".canvas-scroll")!,
    docNameEl: root.querySelector<HTMLElement>(".pane-doc-name")!,
    docView: root.querySelector<HTMLElement>(".doc-view")!,
  };
}
