import { createValidAbsoluteUrl } from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from "pdfjs-dist";
import { getPane } from "./dom";
import { goToPdfPage } from "./pdf-navigate";
import { session } from "./session";
import type { PaneSide } from "./types";

const LINK_ANNOTATION_TYPE = 2;

function isLinkAnnotation(a: { subtype?: string; annotationType?: number }): boolean {
  return a.subtype === "Link" || a.annotationType === LINK_ANNOTATION_TYPE;
}

function isRefLike(v: unknown): v is { num: number; gen: number } {
  return (
    typeof v === "object" &&
    v !== null &&
    "num" in v &&
    "gen" in v &&
    typeof (v as { num: unknown }).num === "number"
  );
}

/**
 * Resolve a PDF link destination to a 1-based page index.
 * See PDF spec named / explicit destinations and pdf.js worker serialization.
 */
export async function resolveDestToOneBasedPage(
  doc: PDFDocumentProxy,
  dest: string | unknown[] | null | undefined
): Promise<number | null> {
  if (dest == null || dest === "") return null;

  let explicit: unknown[] | null = null;
  if (typeof dest === "string") {
    explicit = (await doc.getDestination(dest)) as unknown[] | null;
  } else if (Array.isArray(dest)) {
    explicit = dest.slice();
  }
  if (!explicit?.length) return null;

  const rawPage = explicit[0];
  if (isRefLike(rawPage)) {
    try {
      const idx = await doc.getPageIndex(rawPage);
      return idx + 1;
    } catch {
      return null;
    }
  }
  if (typeof rawPage === "number" && Number.isInteger(rawPage)) {
    return rawPage + 1;
  }
  return null;
}

function viewportRectPercentages(
  viewport: PageViewport,
  pdfRect: number[]
): { leftPct: number; topPct: number; widthPct: number; heightPct: number } {
  const [vx1, vy1, vx2, vy2] = viewport.convertToViewportRectangle(pdfRect);
  const w = viewport.width;
  const h = viewport.height;
  const left = Math.min(vx1, vx2);
  const top = Math.min(vy1, vy2);
  const rw = Math.abs(vx2 - vx1);
  const rh = Math.abs(vy2 - vy1);
  return {
    leftPct: (left / w) * 100,
    topPct: (top / h) * 100,
    widthPct: (rw / w) * 100,
    heightPct: (rh / h) * 100,
  };
}

/** Bounding box in PDF user space from /QuadPoints (groups of 8 PDF coords). */
function quadPointsPdfBBox(quadPoints: Float32Array): number[] | null {
  if (!quadPoints?.length || quadPoints.length % 8 !== 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < quadPoints.length; i += 2) {
    const x = quadPoints[i];
    const y = quadPoints[i + 1];
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return null;
  return [minX, minY, maxX, maxY];
}

function placeHitArea(
  viewport: PageViewport,
  el: HTMLElement,
  rect: number[],
  quadPoints?: Float32Array | null
): void {
  const pdfRect = quadPoints?.length ? quadPointsPdfBBox(quadPoints) ?? rect : rect;
  const { leftPct, topPct, widthPct, heightPct } = viewportRectPercentages(viewport, pdfRect);
  el.style.left = `${leftPct}%`;
  el.style.top = `${topPct}%`;
  el.style.width = `${widthPct}%`;
  el.style.height = `${heightPct}%`;
}

/**
 * Renders clickable regions for PDF Link annotations (internal cross-refs and external URLs).
 */
export async function paintPdfInnerLinks(
  side: PaneSide,
  page: PDFPageProxy,
  viewport: PageViewport,
  container: HTMLElement,
  preloadedPdfAnnotations?: Array<Record<string, unknown>>
): Promise<void> {
  container.replaceChildren();
  container.classList.add("pdf-link-layer");

  const doc = session.paneState[side].doc;
  if (!doc) return;

  let annotations: Array<Record<string, unknown>>;
  try {
    annotations =
      preloadedPdfAnnotations ??
      ((await page.getAnnotations({ intent: "display" })) as Array<Record<string, unknown>>);
  } catch {
    return;
  }

  for (const raw of annotations) {
    if (!isLinkAnnotation(raw as { subtype?: string; annotationType?: number })) continue;

    const rect = raw.rect as number[] | undefined;
    if (!rect || rect.length < 4) continue;

    const dest = raw.dest as string | unknown[] | undefined;
    const url = (raw.url || raw.unsafeUrl) as string | undefined | null;
    const action = raw.action as string | undefined | null;
    const quadPoints = raw.quadPoints as Float32Array | undefined | null;

    const hit = document.createElement("button");
    hit.type = "button";
    hit.className = "pdf-link-hit";
    hit.tabIndex = 0;

    placeHitArea(viewport, hit, rect, quadPoints);

    const openExternal = (u: string): void => {
      const abs =
        createValidAbsoluteUrl(u, window.location.href) ?? createValidAbsoluteUrl(u, undefined);
      if (abs) window.open(abs.href, "_blank", "noopener,noreferrer");
    };

    if (url) {
      hit.title = "External link";
      hit.setAttribute("aria-label", "External document link");
      hit.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        openExternal(url);
      });
    } else if (action) {
      hit.title = action;
      hit.setAttribute("aria-label", `PDF action: ${action}`);
      hit.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        runNamedPdfAction(side, action);
      });
    } else if (dest !== undefined && dest !== null) {
      hit.title = "Go to destination in this document";
      hit.setAttribute("aria-label", "Internal document link");
      hit.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        void (async () => {
          const pageNum = await resolveDestToOneBasedPage(doc, dest);
          if (pageNum != null) goToPdfPage(side, pageNum);
        })();
      });
    } else {
      continue;
    }

    container.append(hit);
  }
}

function runNamedPdfAction(side: PaneSide, action: string): void {
  const p = getPane(side);
  const doc = session.paneState[side].doc;
  if (!doc) return;
  const n = doc.numPages;
  let cur = parseInt(p.pageInput.value, 10) || 1;

  switch (action) {
    case "NextPage":
      goToPdfPage(side, cur + 1);
      break;
    case "PrevPage":
      goToPdfPage(side, cur - 1);
      break;
    case "FirstPage":
      goToPdfPage(side, 1);
      break;
    case "LastPage":
      goToPdfPage(side, n);
      break;
    default:
      break;
  }
}
