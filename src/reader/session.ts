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

/** Mutable reader session (single bag so small modules can share state without `export let`). */
export const session = {
  paneState: { left: emptyPanePdfState(), right: emptyPanePdfState() } as Record<PaneSide, PanePdfState>,
  noteMode: false,
  pendingNotePlacement: null as PendingNotePlacement | null,
  noteDialogEditingId: null as string | null,
  noteDialogEditContext: null as { pane: PaneSide; page: number } | null,

  paneTextLayers: new Map<PaneSide, TextLayer | null>(),
  paneLayoutSnapshot: new Map<PaneSide, { w: number; h: number }>(),
  paneWheelNavAt: new Map<PaneSide, number>(),

  paneZoomMultiplier: { left: 1, right: 1 } as Record<PaneSide, number>,
  paneBaseFit: { left: "page" as PaneBaseFit, right: "page" as PaneBaseFit },
  paneScrollMode: { left: "continuous" as PaneScrollMode, right: "continuous" as PaneScrollMode },

  continuousRev: { left: 0, right: 0 } as Record<PaneSide, number>,
  continuousBuiltRev: { left: -1, right: -1 } as Record<PaneSide, number>,
  continuousObservers: new Map<PaneSide, IntersectionObserver>(),
  continuousTextLayers: new Map<string, TextLayer | null>(),
  continuousSlotRenderTail: new Map<string, Promise<unknown>>(),
  continuousScrollHandler: {} as Partial<Record<PaneSide, () => void>>,
  continuousScrollRaf: null as number | null,

  pendingHighlight: null as PendingHighlight | null,
  highlightPopoverAnchorEl: null as HTMLElement | null,
  lastSelectionFloatSide: null as PaneSide | null,
  selectionFloatRaf: null as number | null,
};

export const highlightColorPopover = document.getElementById("highlight-color-popover") as HTMLDivElement | null;
