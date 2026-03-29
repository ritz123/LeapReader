import type { AnnotationRecord, DocumentMeta, LibraryRecord } from "./storage-types";
import * as file from "./storage-file";
import * as idb from "./storage-idb";

export type { AnnotationPane, AnnotationRecord, DocumentMeta, LibraryRecord } from "./storage-types";

function useFileBackend(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { leapReaderStorage?: { readText?: unknown } }).leapReaderStorage
      ?.readText === "function"
  );
}

let fileInitPromise: Promise<void> | null = null;

async function ensureFileInit(): Promise<void> {
  if (!useFileBackend()) return;
  if (!fileInitPromise) {
    fileInitPromise = (async () => {
      const man = await file.readManifest();
      if (man) return;
      const libs = await idb.listLibraries();
      const docs = await idb.listRecentDocuments(500);
      const hasIdb = libs.length > 0 || docs.length > 0;
      if (hasIdb) {
        await file.importFromIdb({
          libraries: libs,
          documents: docs,
          exportDocument: idb.exportDocumentForMigration,
          listAnnotations: idb.listAnnotations,
        });
      } else {
        await file.writeInitialEmpty();
      }
      await file.writeManifest({ v: 1 });
    })();
  }
  await fileInitPromise;
}

/** Absolute data folder when running in the Electron app; otherwise `null`. */
export async function getDesktopDataDirPath(): Promise<string | null> {
  if (!useFileBackend()) return null;
  await ensureFileInit();
  return file.getDesktopDataDirPath();
}

export async function saveOpenedDocument(
  name: string,
  data: ArrayBuffer,
  lastModified: number
): Promise<string | null> {
  if (useFileBackend()) {
    await ensureFileInit();
    return file.saveOpenedDocument(name, data, lastModified);
  }
  return idb.saveOpenedDocument(name, data, lastModified);
}

export async function touchDocumentOpened(id: string): Promise<void> {
  if (useFileBackend()) {
    await ensureFileInit();
    return file.touchDocumentOpened(id);
  }
  return idb.touchDocumentOpened(id);
}

export async function getDocumentData(
  id: string
): Promise<{ name: string; data: ArrayBuffer } | null> {
  if (useFileBackend()) {
    await ensureFileInit();
    return file.getDocumentData(id);
  }
  return idb.getDocumentData(id);
}

export async function getDocumentMeta(id: string): Promise<DocumentMeta | null> {
  if (useFileBackend()) {
    await ensureFileInit();
    return file.getDocumentMeta(id);
  }
  return idb.getDocumentMeta(id);
}

export async function listRecentDocuments(limit = 60): Promise<DocumentMeta[]> {
  if (useFileBackend()) {
    await ensureFileInit();
    return file.listRecentDocuments(limit);
  }
  return idb.listRecentDocuments(limit);
}

export async function listAnnotations(docId: string): Promise<AnnotationRecord[]> {
  if (useFileBackend()) {
    await ensureFileInit();
    return file.listAnnotations(docId);
  }
  return idb.listAnnotations(docId);
}

/** All highlights and notes (for backup / export). */
export async function listAllAnnotations(): Promise<AnnotationRecord[]> {
  if (useFileBackend()) {
    await ensureFileInit();
    return file.listAllAnnotations();
  }
  return idb.listAllAnnotations();
}

export async function putAnnotation(rec: AnnotationRecord): Promise<void> {
  if (useFileBackend()) {
    await ensureFileInit();
    return file.putAnnotation(rec);
  }
  return idb.putAnnotation(rec);
}

export async function getAnnotation(id: string): Promise<AnnotationRecord | null> {
  if (useFileBackend()) {
    await ensureFileInit();
    return file.getAnnotation(id);
  }
  return idb.getAnnotation(id);
}

export async function reassignAnnotationsDocId(fromDocId: string, toDocId: string): Promise<void> {
  if (useFileBackend()) {
    await ensureFileInit();
    return file.reassignAnnotationsDocId(fromDocId, toDocId);
  }
  return idb.reassignAnnotationsDocId(fromDocId, toDocId);
}

export async function updateNoteText(id: string, text: string): Promise<boolean> {
  if (useFileBackend()) {
    await ensureFileInit();
    return file.updateNoteText(id, text);
  }
  return idb.updateNoteText(id, text);
}

export async function deleteAnnotation(id: string): Promise<void> {
  if (useFileBackend()) {
    await ensureFileInit();
    return file.deleteAnnotation(id);
  }
  return idb.deleteAnnotation(id);
}

export async function deleteDocument(id: string): Promise<void> {
  if (useFileBackend()) {
    await ensureFileInit();
    return file.deleteDocument(id);
  }
  return idb.deleteDocument(id);
}

export async function createLibrary(name: string): Promise<LibraryRecord | null> {
  if (useFileBackend()) {
    await ensureFileInit();
    return file.createLibrary(name);
  }
  return idb.createLibrary(name);
}

export async function listLibraries(): Promise<LibraryRecord[]> {
  if (useFileBackend()) {
    await ensureFileInit();
    return file.listLibraries();
  }
  return idb.listLibraries();
}

export async function getLibrary(id: string): Promise<LibraryRecord | null> {
  if (useFileBackend()) {
    await ensureFileInit();
    return file.getLibrary(id);
  }
  return idb.getLibrary(id);
}

export async function renameLibrary(id: string, name: string): Promise<boolean> {
  if (useFileBackend()) {
    await ensureFileInit();
    return file.renameLibrary(id, name);
  }
  return idb.renameLibrary(id, name);
}

export async function deleteLibrary(id: string): Promise<void> {
  if (useFileBackend()) {
    await ensureFileInit();
    return file.deleteLibrary(id);
  }
  return idb.deleteLibrary(id);
}

export async function addDocumentToLibrary(
  libraryId: string,
  documentId: string
): Promise<boolean> {
  if (useFileBackend()) {
    await ensureFileInit();
    return file.addDocumentToLibrary(libraryId, documentId);
  }
  return idb.addDocumentToLibrary(libraryId, documentId);
}

/** Library created on demand; opened PDFs are added here automatically. */
export const IMPORTED_LIBRARY_NAME = "Imported";

/** Ensures `documentId` is in the **Imported** library (creates it if needed). Best-effort; never throws. */
export async function ensureDocumentInImportedLibrary(documentId: string): Promise<void> {
  if (!documentId || documentId.startsWith("unsaved:")) return;
  try {
    const libs = await listLibraries();
    let target = libs.find((l) => l.name === IMPORTED_LIBRARY_NAME);
    if (!target) {
      const created = await createLibrary(IMPORTED_LIBRARY_NAME);
      if (!created) return;
      target = created;
    }
    await addDocumentToLibrary(target.id, documentId);
  } catch (e) {
    console.warn("ensureDocumentInImportedLibrary failed", e);
  }
}

export async function removeDocumentFromLibrary(
  libraryId: string,
  documentId: string
): Promise<void> {
  if (useFileBackend()) {
    await ensureFileInit();
    return file.removeDocumentFromLibrary(libraryId, documentId);
  }
  return idb.removeDocumentFromLibrary(libraryId, documentId);
}

export async function listLibrariesContainingDocument(
  documentId: string
): Promise<{ id: string; name: string }[]> {
  if (useFileBackend()) {
    await ensureFileInit();
    return file.listLibrariesContainingDocument(documentId);
  }
  return idb.listLibrariesContainingDocument(documentId);
}
