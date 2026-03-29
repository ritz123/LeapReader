/**
 * Breaks the layout ↔ rendering dependency cycle: layout code notifies here;
 * bootstrap registers the real action (e.g. re-render panes).
 */
let afterLayoutHandler: () => void = () => {};

export function setAfterLayoutHandler(handler: () => void): void {
  afterLayoutHandler = handler;
}

export function notifyAfterLayoutChange(): void {
  afterLayoutHandler();
}
