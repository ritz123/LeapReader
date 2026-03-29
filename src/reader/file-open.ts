import * as storage from "../storage";
import { updateAddToLibraryButton } from "./chrome-toolbar";
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
    try {
      const buf = await file.arrayBuffer();
      const idbCopy = buf.slice(0);
      const firstOpen = bothPanesEmpty();
      if (firstOpen) {
        await loadPdfBufferInitialBoth(buf, file.name, null);
      } else {
        await loadPdfBuffer(buf, file.name, null, side);
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
        } else {
          session.paneState[side].storageId = id;
          session.paneState[side].annotationDocId = id;
        }
        void storage.ensureDocumentInImportedLibrary(id);
        updateAddToLibraryButton();
        await renderBothPanes();
      }
    } catch (err) {
      console.error("Failed to open PDF", err);
      alert(
        "Could not open this PDF. If you are on an older phone browser, try updating the WebView or Chrome."
      );
    }
  });
}
