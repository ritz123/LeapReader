import * as storage from "../storage";
import { docTypeFromName, loadDocBuffer, loadDocBufferInitialBoth } from "./doc-session";
import { emitPaneDocChanged, emitBothPanesDocChanged } from "./pane-events";
import { bothPanesEmpty } from "./pane-queries";
import { loadPdfBuffer, loadPdfBufferInitialBoth } from "./pdf-session";
import { renderBothPanes } from "./render-registry";
import { session } from "./session";
import type { PaneSide } from "./types";

/**
 * Open a document from a file buffer (file input, drag/drop, or desktop shell).
 * @param targetPane — pane to use when a file is already open; opening into an empty app loads both panes.
 */
export async function openDocumentBuffer(
  buffer: ArrayBuffer,
  name: string,
  lastModified: number,
  targetPane: PaneSide
): Promise<void> {
  const isDoc = docTypeFromName(name) !== null;
  const idbCopy = buffer.slice(0);

  const firstOpen = bothPanesEmpty();
  if (isDoc) {
    if (firstOpen) {
      await loadDocBufferInitialBoth(buffer, name, null);
    } else {
      await loadDocBuffer(buffer, name, null, targetPane);
    }
  } else {
    if (firstOpen) {
      await loadPdfBufferInitialBoth(buffer, name, null);
    } else {
      await loadPdfBuffer(buffer, name, null, targetPane);
    }
  }

  const id = await storage.saveOpenedDocument(name, idbCopy, lastModified);
  if (id) {
    const oldAnnId = firstOpen
      ? session.paneState.left.annotationDocId
      : session.paneState[targetPane].annotationDocId;
    if (oldAnnId && oldAnnId !== id) {
      await storage.reassignAnnotationsDocId(oldAnnId, id);
    }
    if (firstOpen) {
      for (const s of ["left", "right"] as const) {
        session.paneState[s].storageId = id;
        session.paneState[s].annotationDocId = id;
      }
      emitBothPanesDocChanged();
    } else {
      session.paneState[targetPane].storageId = id;
      session.paneState[targetPane].annotationDocId = id;
      emitPaneDocChanged(targetPane);
    }
    void storage.ensureDocumentInImportedLibrary(id);
  }

  if (!isDoc) await renderBothPanes();
}

export function wireFileInput(inputId: string, side: PaneSide): void {
  document.getElementById(inputId)!.addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    try {
      const buf = await file.arrayBuffer();
      await openDocumentBuffer(buf, file.name, file.lastModified, side);
    } catch (err) {
      console.error("Failed to open file", err);
      alert("Could not open this file. Please check it is a valid PDF, Word, or text document.");
    }
  });
}
