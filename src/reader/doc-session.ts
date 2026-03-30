import { updatePaneChrome, updateHeaderSummary } from "./chrome-toolbar";
import { getPane } from "./dom";
import { emptyPanePdfState } from "./pane-model";
import { teardownContinuousUi } from "./pdf-continuous";
import { session } from "./session";
import type { DocType, PaneSide } from "./types";
import { syncZoomUi } from "./zoom-pane";

/** Returns the DocType for a filename, or null if it is a PDF/unsupported. */
export function docTypeFromName(name: string): DocType | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "docx") return "docx";
  if (ext === "doc") return "doc";
  if (ext === "txt") return "txt";
  return null;
}

/** Convert an ArrayBuffer to HTML based on the file type. */
async function toHtml(buf: ArrayBuffer, type: DocType): Promise<string> {
  if (type === "txt") {
    const text = new TextDecoder().decode(buf);
    const escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `<pre class="doc-view__text">${escaped}</pre>`;
  }
  // docx and doc: use mammoth (lazy-loaded to keep the initial bundle small)
  const mammoth = (await import("mammoth")).default;
  const result = await mammoth.convertToHtml({ arrayBuffer: buf });
  return result.value;
}

/** Load a Word / text document into both panes (used on first open). */
export async function loadDocBufferInitialBoth(
  buf: ArrayBuffer,
  name: string,
  storageId: string | null
): Promise<void> {
  await Promise.all([
    loadDocBuffer(buf.slice(0), name, storageId, "left"),
    loadDocBuffer(buf.slice(0), name, storageId, "right"),
  ]);
}

/** Load a Word / text document into a pane. */
export async function loadDocBuffer(
  buf: ArrayBuffer,
  name: string,
  storageId: string | null,
  side: PaneSide
): Promise<void> {
  const type = docTypeFromName(name);
  if (!type) throw new Error(`Unsupported document type: ${name}`);

  // Tear down any existing PDF in this pane.
  session.paneTextLayers.get(side)?.cancel();
  session.paneTextLayers.set(side, null);
  const prev = session.paneState[side].doc;
  if (prev) await prev.destroy();
  teardownContinuousUi(side);

  const html = await toHtml(buf, type);

  session.paneState[side] = {
    ...emptyPanePdfState(),
    name,
    storageId,
    annotationDocId: storageId ?? "",
    docHtml: html,
    docType: type,
  };

  const pe = getPane(side);
  pe.canvasScroll.hidden = true;
  pe.docView.hidden = false;
  pe.docView.innerHTML = html;

  updatePaneChrome(side);
  updateHeaderSummary();
  syncZoomUi(side);
}

/** Hide the doc-view and restore the pane to its empty PDF-ready state. */
export function clearDocView(side: PaneSide): void {
  const pe = getPane(side);
  pe.docView.hidden = true;
  pe.docView.innerHTML = "";
  pe.canvasScroll.hidden = false;
}
