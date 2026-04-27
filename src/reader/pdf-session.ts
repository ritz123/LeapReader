import { getPane, waitLayout } from "./dom";
import { emptyPanePdfState } from "./pane-model";
import { emitBothPanesDocChanged, emitPaneDocChanged } from "./pane-events";
import { acquirePdfDoc, releasePdfDoc } from "./pdf-doc-pool";
import { teardownContinuousUi } from "./pdf-continuous";
import { renderBothPanes, renderPane } from "./render-registry";
import { session } from "./session";
import type { PaneSide } from "./types";

export async function clearPane(side: PaneSide): Promise<void> {
  session.paneTextLayers.get(side)?.cancel();
  session.paneTextLayers.set(side, null);
  const p = getPane(side);
  p.textLayer.replaceChildren();
  const st = session.paneState[side];
  const prev = st.doc;
  if (prev && st.docType === "pdf" && st.annotationDocId) {
    await releasePdfDoc(st.annotationDocId);
  } else if (prev) {
    await prev.destroy();
  }
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

  const ann = storageId ?? `unsaved:${name}:${dataByteLength}`;
  const doc = await acquirePdfDoc(ann, data);
  await acquirePdfDoc(ann);
  session.paneState.left = { doc, name, storageId, annotationDocId: ann, docHtml: null, docType: "pdf" };
  session.paneState.right = { doc, name, storageId, annotationDocId: ann, docHtml: null, docType: "pdf" };
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

  const oldSt = session.paneState[side];
  if (oldSt.doc && oldSt.docType === "pdf" && oldSt.annotationDocId) {
    await releasePdfDoc(oldSt.annotationDocId);
  } else if (oldSt.doc) {
    await oldSt.doc.destroy();
  }

  session.paneScrollMode[side] = "continuous";
  session.paneBaseFit[side] = "page";
  teardownContinuousUi(side);
  const pe0 = getPane(side);
  pe0.singlePageShell.hidden = false;
  pe0.continuousStack.hidden = true;

  const dataByteLength = data.byteLength;
  const ann = storageId ?? `unsaved:${name}:${dataByteLength}`;
  const doc = await acquirePdfDoc(ann, data);

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
    annotationDocId: ann,
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
