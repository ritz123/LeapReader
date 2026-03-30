import * as storage from "./storage";
import type { AnnotationRecord } from "./storage-types";

export const LEAP_READER_EXPORT_VERSION = 1 as const;

export type AnnotationsExportDocument = {
  documentId: string;
  documentName: string;
  annotations: AnnotationRecord[];
};

export type AnnotationsExportPayload = {
  leapReaderExportVersion: typeof LEAP_READER_EXPORT_VERSION;
  exportedAt: string;
  annotationCount: number;
  documents: AnnotationsExportDocument[];
};

export async function buildAnnotationsExportPayload(): Promise<AnnotationsExportPayload> {
  const anns = await storage.listAllAnnotations();
  const metas = await storage.listRecentDocuments(500);
  const metaById = new Map(metas.map((m) => [m.id, m]));
  const byDoc = new Map<string, AnnotationRecord[]>();
  for (const a of anns) {
    const list = byDoc.get(a.docId) ?? [];
    list.push(a);
    byDoc.set(a.docId, list);
  }
  const documents: AnnotationsExportDocument[] = [...byDoc.entries()].map(([documentId, annotations]) => ({
    documentId,
    documentName: metaById.get(documentId)?.name ?? "(document not in Recent — name unknown)",
    annotations: [...annotations].sort((x, y) => x.createdAt - y.createdAt || x.page - y.page),
  }));
  documents.sort((a, b) =>
    a.documentName.localeCompare(b.documentName, undefined, { sensitivity: "base" })
  );
  return {
    leapReaderExportVersion: LEAP_READER_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    annotationCount: anns.length,
    documents,
  };
}

export function downloadAnnotationsExport(payload: AnnotationsExportPayload): void {
  const text = JSON.stringify(payload, null, 2);
  const stamp = payload.exportedAt.slice(0, 19).replace(/[:T]/g, "-");
  const filename = `leap-reader-highlights-notes-${stamp}.json`;
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.click();
  URL.revokeObjectURL(url);
}
