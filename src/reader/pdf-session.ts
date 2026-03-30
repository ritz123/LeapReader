import * as pdfjsLib from "pdfjs-dist";
import {
  updateAddToLibraryButton,
  updateHeaderSummary,
  updatePaneChrome,
} from "./chrome-toolbar";
import { getPane, waitLayout } from "./dom";
import { emptyPanePdfState } from "./pane-model";
import { teardownContinuousUi } from "./pdf-continuous";
import { renderBothPanes, renderPane } from "./render-registry";
import { session } from "./session";
import type { PaneSide } from "./types";
import { syncZoomUi } from "./zoom-pane";

export async function clearPane(side: PaneSide): Promise<void> {
  session.paneTextLayers.get(side)?.cancel();
  session.paneTextLayers.set(side, null);
  const p = getPane(side);
  p.textLayer.replaceChildren();
  const prev = session.paneState[side].doc;
  if (prev) {
    await prev.destroy();
  }
  session.paneState[side] = emptyPanePdfState();
  session.paneZoomMultiplier[side] = 1;
  session.paneBaseFit[side] = "page";
  session.paneScrollMode[side] = "continuous";
  teardownContinuousUi(side);
  const pe = getPane(side);
  // Ensure doc-view is hidden and canvas-scroll is restored.
  pe.docView.hidden = true;
  pe.docView.innerHTML = "";
  pe.canvasScroll.hidden = false;
  pe.singlePageShell.hidden = false;
  pe.continuousStack.hidden = true;
  updatePaneChrome(side);
  updateHeaderSummary();
  syncZoomUi(side);
}

export async function clearPaneForDeletedStorage(docId: string): Promise<void> {
  for (const side of ["left", "right"] as const) {
    if (session.paneState[side].storageId === docId) {
      await clearPane(side);
    }
  }
  updateAddToLibraryButton();
}

export async function loadPdfBufferInitialBoth(
  data: ArrayBuffer,
  name: string,
  storageId: string | null
): Promise<void> {
  const dataByteLength = data.byteLength;
  session.paneLayoutSnapshot.clear();
  await clearPane("left");
  await clearPane("right");

  const b1 = data.slice(0);
  const b2 = data.slice(0);
  const opts = {
    isEvalSupported: false,
    useSystemFonts: true,
  } as const;
  const [docL, docR] = await Promise.all([
    pdfjsLib.getDocument({ data: new Uint8Array(b1), ...opts }).promise,
    pdfjsLib.getDocument({ data: new Uint8Array(b2), ...opts }).promise,
  ]);
  const ann = storageId ?? `unsaved:${name}:${dataByteLength}`;
  session.paneState.left = { doc: docL, name, storageId, annotationDocId: ann, docHtml: null, docType: "pdf" };
  session.paneState.right = { doc: docR, name, storageId, annotationDocId: ann, docHtml: null, docType: "pdf" };
  getPane("left").pageInput.value = "1";
  getPane("right").pageInput.value = "1";
  updatePaneChrome("left");
  updatePaneChrome("right");
  updateHeaderSummary();
  await waitLayout();
  await renderBothPanes();
  updateAddToLibraryButton();
}

export async function loadPdfBuffer(
  data: ArrayBuffer,
  name: string,
  storageId: string | null,
  side: PaneSide
): Promise<void> {
  session.paneLayoutSnapshot.delete(side);
  session.paneTextLayers.get(side)?.cancel();
  session.paneTextLayers.set(side, null);
  getPane(side).textLayer.replaceChildren();

  const prev = session.paneState[side].doc;
  if (prev) {
    await prev.destroy();
  }

  session.paneScrollMode[side] = "continuous";
  session.paneBaseFit[side] = "page";
  teardownContinuousUi(side);
  const pe0 = getPane(side);
  pe0.singlePageShell.hidden = false;
  pe0.continuousStack.hidden = true;

  const dataByteLength = data.byteLength;
  const task = pdfjsLib.getDocument({
    data: new Uint8Array(data),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
  const doc = await task;
  // Ensure doc-view is hidden when loading a PDF.
  const pe = getPane(side);
  pe.docView.hidden = true;
  pe.docView.innerHTML = "";
  pe.canvasScroll.hidden = false;

  session.paneState[side] = {
    doc,
    name,
    storageId,
    annotationDocId: storageId ?? `unsaved:${name}:${dataByteLength}`,
    docHtml: null,
    docType: "pdf",
  };
  session.paneZoomMultiplier[side] = 1;
  getPane(side).pageInput.value = "1";
  updatePaneChrome(side);
  updateHeaderSummary();
  await waitLayout();
  await renderPane(side);
  updateAddToLibraryButton();
}
