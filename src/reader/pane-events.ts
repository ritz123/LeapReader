/**
 * Typed event bus for pane document-state changes.
 *
 * Design principles
 * -----------------
 * - Open/Closed: subscribers (chrome, zoom, header, …) register once and react
 *   automatically — emitters never need updating when new subscribers are added.
 * - Single Responsibility: each chrome module owns its own subscription;
 *   state-changing modules (pdf-session, doc-session) just emit and move on.
 * - Handlers run synchronously so the DOM is in sync before any async render.
 */

import type { PaneSide } from "./types";

type PaneHandler = (side: PaneSide) => void;

function makeChannel<T>() {
  const subs = new Set<(v: T) => void>();
  return {
    subscribe(fn: (v: T) => void): () => void {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    emit(v: T): void {
      for (const fn of subs) fn(v);
    },
  };
}

const docChangedChannel = makeChannel<PaneSide>();

/**
 * Register a handler called whenever one pane's document state changes
 * (document loaded, cleared, or replaced).
 * Returns an unsubscribe function.
 */
export function onPaneDocChanged(fn: PaneHandler): () => void {
  return docChangedChannel.subscribe(fn);
}

/**
 * Emit that a single pane's document state just changed.
 * All registered handlers run synchronously before this returns.
 */
export function emitPaneDocChanged(side: PaneSide): void {
  docChangedChannel.emit(side);
}

/**
 * Emit that both panes changed simultaneously
 * (e.g. loadPdfBufferInitialBoth / loadDocBufferInitialBoth).
 */
export function emitBothPanesDocChanged(): void {
  docChangedChannel.emit("left");
  docChangedChannel.emit("right");
}
