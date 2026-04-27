import type { TextLayer } from "pdfjs-dist";
import { emptyPanePdfState } from "./pane-model";
import type {
  PaneBaseFit,
  PanePdfState,
  PaneScrollMode,
  PaneSide,
  PendingHighlight,
  PendingNotePlacement,
} from "./types";

/**
 * Mutable reader session — the single source of truth for runtime state.
 *
 * Properties are grouped by concern but kept in one object so small modules
 * can share state without a web of circular `export let` chains.
 *
 * Rule: mutate session properties inside domain modules (pdf-session,
 * doc-session, zoom-pane, …); never mutate them from UI/chrome modules.
 */
export const session = {
  // ── Document state ────────────────────────────────────────────────────────
  /** Per-pane loaded document state (PDF handle or rendered HTML + metadata). */
  paneState: {
    left: emptyPanePdfState(),
    right: emptyPanePdfState(),
  } as Record<PaneSide, PanePdfState>,

  // ── Render / layout state ─────────────────────────────────────────────────
  paneTextLayers: new Map<PaneSide, TextLayer | null>(),
  /** Last measured canvas-wrap size; cleared when layout changes to force re-render. */
  paneLayoutSnapshot: new Map<PaneSide, { w: number; h: number }>(),
  paneWheelNavAt: new Map<PaneSide, number>(),
  paneZoomMultiplier: { left: 1, right: 1 } as Record<PaneSide, number>,
  paneBaseFit: {
    left: "page" as PaneBaseFit,
    right: "page" as PaneBaseFit,
  },
  /** PDF page fitting area: `null` uses full pane; otherwise width÷height of the inset box (letterboxed). */
  panePageFrameAspect: { left: null as number | null, right: null as number | null },
  paneScrollMode: {
    left: "continuous" as PaneScrollMode,
    right: "continuous" as PaneScrollMode,
  },
  /**
   * Incremented on each single-page PDF paint; stale async text/link layers bail out so
   * rapid navigation (e.g. internal links) does not apply outdated work.
   */
  pdfInteractiveGen: { left: 0, right: 0 } as Record<PaneSide, number>,

  // ── Continuous-scroll internals ───────────────────────────────────────────
  continuousRev: { left: 0, right: 0 } as Record<PaneSide, number>,
  continuousBuiltRev: { left: -1, right: -1 } as Record<PaneSide, number>,
  continuousObservers: new Map<PaneSide, IntersectionObserver>(),
  continuousTextLayers: new Map<string, TextLayer | null>(),
  continuousSlotRenderTail: new Map<string, Promise<unknown>>(),
  continuousScrollHandler: {} as Partial<Record<PaneSide, () => void>>,
  continuousScrollRaf: null as number | null,

  // ── UI / interaction state ────────────────────────────────────────────────
  noteMode: false,
  pendingNotePlacement: null as PendingNotePlacement | null,
  noteDialogEditingId: null as string | null,
  noteDialogEditContext: null as { pane: PaneSide; page: number } | null,
  pendingHighlight: null as PendingHighlight | null,
  /** Anchor element used to position the highlight colour popover. */
  highlightPopoverAnchorEl: null as HTMLElement | null,
  lastSelectionFloatSide: null as PaneSide | null,
  selectionFloatRaf: null as number | null,
};

/**
 * Lazily resolved highlight-colour popover element.
 * Kept outside the session object so it is tree-shakeable and does not
 * pollute the session data model.
 *
 * Evaluated on first call so this file is safe to import before DOMReady
 * (though in practice <script type="module"> always runs after DOMReady).
 */
let _highlightColorPopover: HTMLDivElement | null | undefined;
export function getHighlightColorPopover(): HTMLDivElement | null {
  if (_highlightColorPopover === undefined) {
    _highlightColorPopover =
      document.getElementById("highlight-color-popover") as HTMLDivElement | null;
  }
  return _highlightColorPopover;
}

