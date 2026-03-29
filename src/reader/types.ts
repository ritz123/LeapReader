import type { PDFDocumentProxy } from "pdfjs-dist";

export type PaneSide = "left" | "right";

export interface PaneElements {
  root: HTMLElement;
  singlePageShell: HTMLElement;
  continuousStack: HTMLElement;
  pageViewport: HTMLElement;
  canvas: HTMLCanvasElement;
  textLayer: HTMLElement;
  highlightsLayer: HTMLElement;
  notesLayer: HTMLElement;
  pageInput: HTMLInputElement;
  prevBtn: HTMLButtonElement;
  nextBtn: HTMLButtonElement;
  canvasWrap: HTMLElement;
  canvasScroll: HTMLElement;
  docNameEl: HTMLElement;
}

export interface PanePdfState {
  doc: PDFDocumentProxy | null;
  name: string;
  storageId: string | null;
  annotationDocId: string;
}

export type PaneBaseFit = "page" | "width";
export type PaneScrollMode = "single" | "continuous";

export type PendingNotePlacement = {
  side: PaneSide;
  pageNum: number;
  x: number;
  y: number;
};

export interface PendingHighlight {
  side: PaneSide;
  pageNum: number;
  rects: { l: number; t: number; w: number; h: number }[];
  quote: string;
  annotationDocId: string;
}
