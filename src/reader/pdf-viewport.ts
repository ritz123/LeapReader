import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from "pdfjs-dist";

/**
 * PDF.js 4 TextLayer sizes glyphs with `calc(var(--scale-factor) * …)` (see setLayerDimensions).
 * The stock viewer sets this on the layer; without it, font sizes collapse to defaults and
 * selection / highlight rects no longer match the canvas.
 */
export function bindTextLayerScale(textLayerContainer: HTMLElement, viewport: PageViewport): void {
  textLayerContainer.style.setProperty("--scale-factor", String(viewport.scale));
}
import { session } from "./session";
import type { PaneSide } from "./types";

export function fitScale(pageWidth: number, pageHeight: number, maxW: number, maxH: number): number {
  const sx = maxW / pageWidth;
  const sy = maxH / pageHeight;
  return Math.min(sx, sy, 2.5);
}

export async function getScaledPageViewport(
  side: PaneSide,
  doc: PDFDocumentProxy,
  pageNum: number,
  maxW: number,
  maxH: number
): Promise<{ page: PDFPageProxy; viewport: PageViewport }> {
  const page = await doc.getPage(pageNum);
  const v1 = page.getViewport({ scale: 1 });
  const mult = session.paneZoomMultiplier[side];
  let scale: number;
  if (session.paneBaseFit[side] === "width") {
    const base = Math.min(maxW / v1.width, 6);
    scale = base * mult;
  } else {
    scale = fitScale(v1.width, v1.height, maxW, maxH) * mult;
  }
  const viewport = page.getViewport({ scale });
  return { page, viewport };
}
