import * as pdfjsLib from "pdfjs-dist";
import { getPane, waitLayout } from "./dom";
import { emptyPanePdfState } from "./pane-model";
import { emitBothPanesDocChanged, emitPaneDocChanged } from "./pane-events";
import { teardownContinuousUi } from "./pdf-continuous";
import { renderBothPanes, renderPane } from "./render-registry";
import { session } from "./session";
import type { PaneSide } from "./types";

export async function clearPane(side: PaneSide): Promise<void> {
  session.paneTextLayers.get(side)?.cancel();
  session.paneTextLayers.set(side, null);
  const p = getPane(side);
  p.textLayer.replaceChildren();
  const prev = session.paneState[side].doc;
  if (prev) await prev.destroy();
  session.paneState[side] = emptyPanePdfState();
  session.paneZoomMultiplier[side] = 1;
  session.paneBaseFit[side] = "page";
  session.paneScrollMode[side] = "continuous";
  teardownContinuousUi(side);
  const pe = getPane(side);
  pe.docView.hidden = true;
  pe.docView.innerHTML = "";
  pe.canvasScroll.hidden = false;
  pe.singlePageShell.hidden = false;
  pe.continuousStack.hidden = true;
  // Single emit replaces: updatePaneChrome + updateHeaderSummary + syncZoomUi
  emitPaneDocChanged(side);
}

export async function clearPaneForDeletedStorage(docId: string): Promise<void> {
  for (const side of ["left", "right"] as const) {
    if (session.paneState[side].storageId === docId) {
      await clearPane(side);
    }
  }
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
  const opts = { isEvalSupported: false, useSystemFonts: true } as const;
  const [docL, docR] = await Promise.all([
    pdfjsLib.getDocument({ data: new Uint8Array(b1), ...opts }).promise,
    pdfjsLib.getDocument({ data: new Uint8Array(b2), ...opts }).promise,
  ]);
  const ann = storageId ?? `unsaved:${name}:${dataByteLength}`;
  session.paneState.left = { doc: docL, name, storageId, annotationDocId: ann, docHtml: null, docType: "pdf" };
  session.paneState.right = { doc: docR, name, storageId, annotationDocId: ann, docHtml: null, docType: "pdf" };
  getPane("left").pageInput.value = "1";
  getPane("right").pageInput.value = "1";
  // Single emit for both panes replaces four explicit chrome-update calls.
  emitBothPanesDocChanged();
  await waitLayout();
  await renderBothPanes();
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
  if (prev) await prev.destroy();

  session.paneScrollMode[side] = "continuous";
  session.paneBaseFit[side] = "page";
  teardownContinuousUi(side);
  const pe0 = getPane(side);
  pe0.singlePageShell.hidden = false;
  pe0.continuousStack.hidden = true;

  const dataByteLength = data.byteLength;
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(data),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  // Ensure doc-view is hidden when loading a PDF.
  const pe = getPane(side);
  pe.docView.hidden = true;
  pe.docView.innerHTML = "";
  delete pe.docView.dataset.docType;
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
  // Single emit replaces: updatePaneChrome + updateHeaderSummary + syncZoomUi + updateAddToLibraryButton
  emitPaneDocChanged(side);
  await waitLayout();
  await renderPane(side);
}
