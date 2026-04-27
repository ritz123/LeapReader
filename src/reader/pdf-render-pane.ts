import { TextLayer } from "pdfjs-dist";
import type { PDFPageProxy, PageViewport } from "pdfjs-dist";
import { paintAnnotations } from "./annotations-paint";
import { updateNavDisabled } from "./chrome-toolbar";
import * as storage from "../storage";
import { getPane, waitLayoutIfPaneSizeChanged } from "./dom";
import { isTabLayoutActive, getActivePaneTab } from "./layout-controller";
import {
  renderAllContinuousSlotsForPrint,
  renderContinuousDocument,
  teardownContinuousUi,
} from "./pdf-continuous";
import { paintPdfInnerLinks } from "./pdf-internal-links";
import { getPdfFitBoxForPane } from "./page-frame";
import { bindTextLayerScale, getScaledPageViewport } from "./pdf-viewport";
import { session } from "./session";
import type { PaneSide } from "./types";
import { syncZoomUi } from "./zoom-pane";

/** Text layer + PDF.js link annotations — often seconds on large pages; run after canvas paints. */
async function runDeferredPdfInteractiveLayers(
  side: PaneSide,
  _pageNum: number,
  page: PDFPageProxy,
  vp: PageViewport,
  gen: number
): Promise<void> {
  if (session.pdfInteractiveGen[side] !== gen) return;

  const p = getPane(side);
  let pdfAnnos: Array<Record<string, unknown>> = [];
  try {
    const [textContent, pdfAnnosResult] = await Promise.all([
      page.getTextContent(),
      page.getAnnotations({ intent: "display" }) as Promise<Array<Record<string, unknown>>>,
    ]);
    pdfAnnos = pdfAnnosResult;
    if (session.pdfInteractiveGen[side] !== gen) return;

    bindTextLayerScale(p.textLayer, vp);
    const tl = new TextLayer({
      textContentSource: textContent,
      container: p.textLayer,
      viewport: vp,
    });
    session.paneTextLayers.set(side, tl);
    await tl.render();
  } catch (err) {
    if (session.pdfInteractiveGen[side] !== gen) return;
    console.warn("Text layer failed (selection may not work)", err);
    session.paneTextLayers.set(side, null);
    return;
  }

  if (session.pdfInteractiveGen[side] !== gen) return;

  const linkLayer = p.pageViewport.querySelector<HTMLElement>(".pdf-link-layer");
  if (linkLayer) {
    try {
      await paintPdfInnerLinks(side, page, vp, linkLayer, pdfAnnos);
    } catch (err) {
      console.warn("PDF link layer failed", err);
    }
  }
}

async function renderSinglePageInPane(
  side: PaneSide,
  opts?: { awaitInteractiveLayers?: boolean }
): Promise<void> {
  const p = getPane(side);
  const doc = session.paneState[side].doc!;
  const n = doc.numPages;
  let pageNum = parseInt(p.pageInput.value, 10);
  if (!Number.isFinite(pageNum)) pageNum = 1;
  pageNum = Math.min(Math.max(1, pageNum), n);
  p.pageInput.value = String(pageNum);

  session.pdfInteractiveGen[side]++;
  const gen = session.pdfInteractiveGen[side];

  session.paneTextLayers.get(side)?.cancel();
  session.paneTextLayers.set(side, null);
  p.textLayer.replaceChildren();
  p.pageViewport.querySelector(".pdf-link-layer")?.replaceChildren();

  const wrap = p.canvasWrap;
  await waitLayoutIfPaneSizeChanged(side, wrap);
  const { maxW, maxH } = getPdfFitBoxForPane(side, wrap);
  const { page, viewport: vp } = await getScaledPageViewport(side, doc, pageNum, maxW, maxH);

  const canvas = p.canvas;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    console.error("Canvas 2D context unavailable");
    return;
  }
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);

  const annId = session.paneState[side].annotationDocId;
  const annListPromise = annId ? storage.listAnnotations(annId) : Promise.resolve([]);

  try {
    const [, userAnnItems] = await Promise.all([
      page.render({ canvasContext: ctx, viewport: vp }).promise,
      annListPromise,
    ]);

    if (session.pdfInteractiveGen[side] !== gen) return;

    try {
      await paintAnnotations(side, pageNum, userAnnItems);
    } catch (err) {
      console.warn("Annotations paint failed", err);
    }
  } catch (err) {
    console.error("PDF page render failed", err);
    session.paneTextLayers.set(side, null);
    return;
  }

  updateNavDisabled();

  session.paneLayoutSnapshot.set(side, {
    w: Math.round(wrap.clientWidth),
    h: Math.round(wrap.clientHeight),
  });
  syncZoomUi(side);

  const awaitLayers = opts?.awaitInteractiveLayers === true;
  const runLayers = (): Promise<void> => runDeferredPdfInteractiveLayers(side, pageNum, page, vp, gen);

  if (awaitLayers) {
    await runLayers();
  } else {
    requestAnimationFrame(() => {
      void runLayers();
    });
  }
}

export type RenderPaneImplOptions = {
  ignoreInactiveTab?: boolean;
  /** Wait for text layer + PDF links (print); default false = paint canvas first, defer the rest. */
  awaitInteractiveLayers?: boolean;
};

export async function renderPaneImpl(
  side: PaneSide,
  opts?: RenderPaneImplOptions
): Promise<void> {
  if (!opts?.ignoreInactiveTab && isTabLayoutActive() && side !== getActivePaneTab()) {
    return;
  }
  const p = getPane(side);
  const st = session.paneState[side];
  const doc = st.doc;
  if (!doc) {
    teardownContinuousUi(side);
    session.paneLayoutSnapshot.delete(side);
    p.canvas.classList.add("hidden");
    // Only remove has-doc if there is no text doc either; text panes keep their own chrome state.
    if (!st.docHtml) p.canvasWrap.classList.remove("has-doc");
    p.highlightsLayer.replaceChildren();
    p.notesLayer.replaceChildren();
    p.textLayer.replaceChildren();
    p.pageViewport.querySelector(".pdf-link-layer")?.replaceChildren();
    return;
  }

  if (session.paneScrollMode[side] === "continuous") {
    await renderContinuousDocument(side);
    return;
  }

  teardownContinuousUi(side);
  p.singlePageShell.hidden = false;
  p.continuousStack.hidden = true;
  p.canvas.classList.remove("hidden");
  await renderSinglePageInPane(side, {
    awaitInteractiveLayers: opts?.awaitInteractiveLayers,
  });
}

/** Build DOM and rasterize every page so browser print is not limited to the on-screen viewport. */
export async function preparePaneForPrint(side: PaneSide): Promise<void> {
  await renderPaneImpl(side, { ignoreInactiveTab: true, awaitInteractiveLayers: true });
  if (session.paneScrollMode[side] === "continuous") {
    await renderAllContinuousSlotsForPrint(side);
  }
}

export async function renderBothPanesImpl(): Promise<void> {
  try {
    await renderPaneImpl("left");
  } catch (err) {
    console.error("Left pane render failed", err);
  }
  try {
    await renderPaneImpl("right");
  } catch (err) {
    console.error("Right pane render failed", err);
  }
}
