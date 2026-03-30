import * as storage from "../storage";
import { docTypeFromName, loadDocBuffer, loadDocBufferInitialBoth } from "./doc-session";
import { emitPaneDocChanged, emitBothPanesDocChanged } from "./pane-events";
import { bothPanesEmpty } from "./pane-queries";
import { loadPdfBuffer, loadPdfBufferInitialBoth } from "./pdf-session";
import { renderBothPanes } from "./render-registry";
import { session } from "./session";
import type { PaneSide } from "./types";

export function wireFileInput(inputId: string, side: PaneSide): void {
  document.getElementById(inputId)!.addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    const isDoc = docTypeFromName(file.name) !== null;

    try {
      const buf = await file.arrayBuffer();
      const idbCopy = buf.slice(0);

      const firstOpen = bothPanesEmpty();
      if (isDoc) {
        if (firstOpen) {
          await loadDocBufferInitialBoth(buf, file.name, null);
        } else {
          await loadDocBuffer(buf, file.name, null, side);
        }
      } else {
        if (firstOpen) {
          await loadPdfBufferInitialBoth(buf, file.name, null);
        } else {
          await loadPdfBuffer(buf, file.name, null, side);
        }
      }

      const id = await storage.saveOpenedDocument(file.name, idbCopy, file.lastModified);
      if (id) {
        const oldAnnId = firstOpen
          ? session.paneState.left.annotationDocId
          : session.paneState[side].annotationDocId;
        if (oldAnnId && oldAnnId !== id) {
          await storage.reassignAnnotationsDocId(oldAnnId, id);
        }
        if (firstOpen) {
          for (const s of ["left", "right"] as const) {
            session.paneState[s].storageId = id;
            session.paneState[s].annotationDocId = id;
          }
          // Re-emit so library buttons reflect the now-assigned storageId.
          emitBothPanesDocChanged();
        } else {
          session.paneState[side].storageId = id;
          session.paneState[side].annotationDocId = id;
          emitPaneDocChanged(side);
        }
        void storage.ensureDocumentInImportedLibrary(id);
      }

      // PDFs need an explicit render pass; doc views render during load.
      if (!isDoc) await renderBothPanes();
    } catch (err) {
      console.error("Failed to open file", err);
      alert("Could not open this file. Please check it is a valid PDF, Word, or text document.");
    }
  });
}
