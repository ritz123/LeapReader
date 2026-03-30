import { TextLayer } from "pdfjs-dist";
import { paintAnnotations } from "./annotations-paint";
import { updateNavDisabled } from "./chrome-toolbar";
import { getPane, waitLayout } from "./dom";
import { isTabLayoutActive, getActivePaneTab } from "./layout-controller";
import {
  renderAllContinuousSlotsForPrint,
  renderContinuousDocument,
  teardownContinuousUi,
} from "./pdf-continuous";
import { bindTextLayerScale, getScaledPageViewport } from "./pdf-viewport";
import { session } from "./session";
import type { PaneSide } from "./types";
import { syncZoomUi } from "./zoom-pane";

async function renderSinglePageInPane(side: PaneSide): Promise<void> {
  const p = getPane(side);
  const doc = session.paneState[side].doc!;
  const n = doc.numPages;
  let pageNum = parseInt(p.pageInput.value, 10);
  if (!Number.isFinite(pageNum)) pageNum = 1;
  pageNum = Math.min(Math.max(1, pageNum), n);
  p.pageInput.value = String(pageNum);

  session.paneTextLayers.get(side)?.cancel();
  session.paneTextLayers.set(side, null);
  p.textLayer.replaceChildren();

  await waitLayout();
  const wrap = p.canvasWrap;
  const maxW = Math.max(100, wrap.clientWidth - 16);
  const maxH = Math.max(100, wrap.clientHeight - 16);
  const { page, viewport: vp } = await getScaledPageViewport(side, doc, pageNum, maxW, maxH);

  const canvas = p.canvas;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    console.error("Canvas 2D context unavailable");
    return;
  }
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);

  try {
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
  } catch (err) {
    console.error("PDF page render failed", err);
    return;
  }

  try {
    const textContent = await page.getTextContent();
    bindTextLayerScale(p.textLayer, vp);
    const tl = new TextLayer({
      textContentSource: textContent,
      container: p.textLayer,
      viewport: vp,
    });
    session.paneTextLayers.set(side, tl);
    await tl.render();
  } catch (err) {
    console.warn("Text layer failed (selection may not work)", err);
    session.paneTextLayers.set(side, null);
  }

  try {
    await paintAnnotations(side, pageNum);
  } catch (err) {
    console.warn("Annotations paint failed", err);
  }
  updateNavDisabled();

  session.paneLayoutSnapshot.set(side, {
    w: Math.round(wrap.clientWidth),
    h: Math.round(wrap.clientHeight),
  });
  syncZoomUi(side);
}

export async function renderPaneImpl(
  side: PaneSide,
  opts?: { ignoreInactiveTab?: boolean }
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
  await renderSinglePageInPane(side);
}

/** Build DOM and rasterize every page so browser print is not limited to the on-screen viewport. */
export async function preparePaneForPrint(side: PaneSide): Promise<void> {
  await renderPaneImpl(side, { ignoreInactiveTab: true });
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
