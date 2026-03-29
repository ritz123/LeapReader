import type { PaneSide } from "./types";

let renderPaneFn: (side: PaneSide) => Promise<void> = async () => {};
let renderBothFn: () => Promise<void> = async () => {};

export function registerPdfRender(
  pane: (side: PaneSide) => Promise<void>,
  both: () => Promise<void>
): void {
  renderPaneFn = pane;
  renderBothFn = both;
}

export function renderPane(side: PaneSide): Promise<void> {
  return renderPaneFn(side);
}

export function renderBothPanes(): Promise<void> {
  return renderBothFn();
}
