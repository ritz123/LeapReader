import type { AnnotationRecord, DocumentMeta, LibraryRecord } from "./storage-types";

const MAX_STORED_DOCUMENTS = 80;

const LIBRARIES_PATH = "libraries.json";
const ANNOTATIONS_PATH = "annotations.json";
const DOC_INDEX_PATH = "documents/index.json";
const MANIFEST_PATH = "manifest.json";

type DocIndexEntry = DocumentMeta & { fingerprint: string };

interface LibrariesFile {
  libraries: LibraryRecord[];
}

interface AnnotationsFile {
  annotations: AnnotationRecord[];
}

interface DocumentsIndexFile {
  documents: DocIndexEntry[];
}

interface ManifestFile {
  v: number;
}

export interface LeapReaderFileApi {
  getDataDirPath(): Promise<string>;
  readText(relPath: string): Promise<string | null>;
  writeText(relPath: string, text: string): Promise<void>;
  readBuffer(relPath: string): Promise<ArrayBuffer | null>;
  writeBuffer(relPath: string, data: ArrayBuffer): Promise<void>;
  unlink(relPath: string): Promise<void>;
  exists(relPath: string): Promise<boolean>;
}

function api(): LeapReaderFileApi {
  const w = window as Window & { leapReaderStorage?: LeapReaderFileApi };
  if (!w.leapReaderStorage) {
    throw new Error("leapReaderStorage unavailable");
  }
  return w.leapReaderStorage;
}

let lockChain: Promise<void> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const next = new Promise<void>((r) => {
    release = r;
  });
  const run = lockChain.then(() => fn());
  lockChain = run.then(() => next, () => next);
  return run.finally(release);
}

function fingerprint(name: string, size: number, lastModified: number): string {
  return `${name}\u0000${size}\u0000${lastModified}`;
}

function pdfPath(id: string): string {
  return `documents/${id}.pdf`;
}

async function readJson<T>(relPath: string, fallback: T): Promise<T> {
  const raw = await api().readText(relPath);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(relPath: string, value: unknown): Promise<void> {
  await api().writeText(relPath, JSON.stringify(value, null, 2));
}

async function readLibraries(): Promise<LibraryRecord[]> {
  const f = await readJson<LibrariesFile>(LIBRARIES_PATH, { libraries: [] });
  return f.libraries ?? [];
}

async function writeLibraries(libs: LibraryRecord[]): Promise<void> {
  await writeJson(LIBRARIES_PATH, { libraries: libs });
}

async function readAnnotations(): Promise<AnnotationRecord[]> {
  const f = await readJson<AnnotationsFile>(ANNOTATIONS_PATH, { annotations: [] });
  return f.annotations ?? [];
}

async function writeAnnotations(anns: AnnotationRecord[]): Promise<void> {
  await writeJson(ANNOTATIONS_PATH, { annotations: anns });
}

async function readDocIndex(): Promise<DocIndexEntry[]> {
  const f = await readJson<DocumentsIndexFile>(DOC_INDEX_PATH, { documents: [] });
  return f.documents ?? [];
}

async function writeDocIndex(docs: DocIndexEntry[]): Promise<void> {
  await writeJson(DOC_INDEX_PATH, { documents: docs });
}

export async function readManifest(): Promise<ManifestFile | null> {
  const raw = await api().readText(MANIFEST_PATH);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as ManifestFile;
  } catch {
    return null;
  }
}

export async function writeManifest(m: ManifestFile): Promise<void> {
  await api().writeText(MANIFEST_PATH, JSON.stringify(m, null, 2));
}

export async function writeInitialEmpty(): Promise<void> {
  await writeJson(LIBRARIES_PATH, { libraries: [] });
  await writeJson(ANNOTATIONS_PATH, { annotations: [] });
  await writeJson(DOC_INDEX_PATH, { documents: [] });
}

export async function getDesktopDataDirPath(): Promise<string> {
  return api().getDataDirPath();
}

async function pruneOldest(): Promise<void> {
  const docs = await readDocIndex();
  if (docs.length <= MAX_STORED_DOCUMENTS) return;
  const sorted = [...docs].sort((a, b) => a.lastOpenedAt - b.lastOpenedAt);
  const removeCount = docs.length - MAX_STORED_DOCUMENTS;
  const victims = sorted.slice(0, removeCount);
  const victimIds = new Set(victims.map((v) => v.id));
  const libs = await readLibraries();
  for (const doc of victims) {
    await api().unlink(pdfPath(doc.id));
  }
  const nextDocs = docs.filter((d) => !victimIds.has(d.id));
  const nextLibs = libs.map((lib) => ({
    ...lib,
    documentIds: lib.documentIds.filter((x) => !victimIds.has(x)),
  }));
  await writeDocIndex(nextDocs);
  await writeLibraries(nextLibs);
  const anns = await readAnnotations();
  await writeAnnotations(anns.filter((a) => !victimIds.has(a.docId)));
}

export async function saveOpenedDocument(
  name: string,
  data: ArrayBuffer,
  lastModified: number
): Promise<string | null> {
  return withLock(async () => {
    try {
      const size = data.byteLength;
      const fp = fingerprint(name, size, lastModified);
      const now = Date.now();
      let docs = await readDocIndex();
      const match = docs.find((d) => d.fingerprint === fp);
      let id: string;
      let createdAt: number;
      if (match) {
        id = match.id;
        createdAt = match.createdAt;
      } else {
        id = crypto.randomUUID();
        createdAt = now;
      }
      await api().writeBuffer(pdfPath(id), data);
      const nextMeta: DocIndexEntry = {
        id,
        name,
        size,
        fingerprint: fp,
        createdAt,
        lastOpenedAt: now,
      };
      if (match) {
        docs = docs.map((d) => (d.id === id ? nextMeta : d));
      } else {
        docs = [...docs, nextMeta];
      }
      await writeDocIndex(docs);
      await pruneOldest();
      return id;
    } catch (e) {
      console.warn("File storage save failed", e);
      return null;
    }
  });
}

export async function touchDocumentOpened(id: string): Promise<void> {
  await withLock(async () => {
    const docs = await readDocIndex();
    const i = docs.findIndex((d) => d.id === id);
    if (i < 0) return;
    docs[i] = { ...docs[i], lastOpenedAt: Date.now() };
    await writeDocIndex(docs);
  });
}

export async function getDocumentData(
  id: string
): Promise<{ name: string; data: ArrayBuffer } | null> {
  try {
    const docs = await readDocIndex();
    const d = docs.find((x) => x.id === id);
    if (!d) return null;
    const buf = await api().readBuffer(pdfPath(id));
    if (!buf) return null;
    return { name: d.name, data: buf };
  } catch {
    return null;
  }
}

export async function getDocumentMeta(id: string): Promise<DocumentMeta | null> {
  const docs = await readDocIndex();
  const d = docs.find((x) => x.id === id);
  if (!d) return null;
  return {
    id: d.id,
    name: d.name,
    size: d.size,
    createdAt: d.createdAt,
    lastOpenedAt: d.lastOpenedAt,
  };
}

export async function listRecentDocuments(limit = 60): Promise<DocumentMeta[]> {
  const docs = await readDocIndex();
  return docs
    .map(({ id, name, size, createdAt, lastOpenedAt }) => ({
      id,
      name,
      size,
      createdAt,
      lastOpenedAt,
    }))
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    .slice(0, limit);
}

export async function listAnnotations(docId: string): Promise<AnnotationRecord[]> {
  const anns = await readAnnotations();
  return anns.filter((a) => a.docId === docId);
}

export async function listAllAnnotations(): Promise<AnnotationRecord[]> {
  return readAnnotations();
}

export async function putAnnotation(rec: AnnotationRecord): Promise<void> {
  await withLock(async () => {
    const anns = await readAnnotations();
    const i = anns.findIndex((a) => a.id === rec.id);
    if (i >= 0) anns[i] = rec;
    else anns.push(rec);
    await writeAnnotations(anns);
  });
}

export async function getAnnotation(id: string): Promise<AnnotationRecord | null> {
  const anns = await readAnnotations();
  return anns.find((a) => a.id === id) ?? null;
}

export async function reassignAnnotationsDocId(fromDocId: string, toDocId: string): Promise<void> {
  if (fromDocId === toDocId) return;
  await withLock(async () => {
    const anns = await readAnnotations();
    let changed = false;
    for (const a of anns) {
      if (a.docId === fromDocId) {
        a.docId = toDocId;
        changed = true;
      }
    }
    if (changed) await writeAnnotations(anns);
  });
}

export async function updateNoteText(id: string, text: string): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return withLock(async () => {
    const anns = await readAnnotations();
    const r = anns.find((a) => a.id === id);
    if (!r || r.kind !== "note") return false;
    r.text = trimmed;
    await writeAnnotations(anns);
    return true;
  });
}

export async function deleteAnnotation(id: string): Promise<void> {
  await withLock(async () => {
    const anns = await readAnnotations().then((list) => list.filter((a) => a.id !== id));
    await writeAnnotations(anns);
  });
}

export async function deleteDocument(id: string): Promise<void> {
  await withLock(async () => {
    await api().unlink(pdfPath(id));
    const docs = (await readDocIndex()).filter((d) => d.id !== id);
    await writeDocIndex(docs);
    const anns = (await readAnnotations()).filter((a) => a.docId !== id);
    await writeAnnotations(anns);
    const libs = await readLibraries();
    for (const lib of libs) {
      if (lib.documentIds.includes(id)) {
        lib.documentIds = lib.documentIds.filter((x) => x !== id);
      }
    }
    await writeLibraries(libs);
  });
}

export async function createLibrary(name: string): Promise<LibraryRecord | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return withLock(async () => {
    const id = crypto.randomUUID();
    const rec: LibraryRecord = { id, name: trimmed, createdAt: Date.now(), documentIds: [] };
    const libs = await readLibraries();
    libs.push(rec);
    await writeLibraries(libs);
    return rec;
  });
}

export async function listLibraries(): Promise<LibraryRecord[]> {
  const libs = await readLibraries();
  return libs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export async function getLibrary(id: string): Promise<LibraryRecord | null> {
  const libs = await readLibraries();
  return libs.find((l) => l.id === id) ?? null;
}

export async function renameLibrary(id: string, name: string): Promise<boolean> {
  const trimmed = name.trim();
  if (!trimmed) return false;
  return withLock(async () => {
    const libs = await readLibraries();
    const prev = libs.find((l) => l.id === id);
    if (!prev) return false;
    prev.name = trimmed;
    await writeLibraries(libs);
    return true;
  });
}

export async function deleteLibrary(id: string): Promise<void> {
  await withLock(async () => {
    const libs = (await readLibraries()).filter((l) => l.id !== id);
    await writeLibraries(libs);
  });
}

export async function addDocumentToLibrary(libraryId: string, documentId: string): Promise<boolean> {
  return withLock(async () => {
    const docs = await readDocIndex();
    if (!docs.some((d) => d.id === documentId)) return false;
    const libs = await readLibraries();
    const lib = libs.find((l) => l.id === libraryId);
    if (!lib) return false;
    if (!lib.documentIds.includes(documentId)) {
      lib.documentIds.push(documentId);
      await writeLibraries(libs);
    }
    return true;
  });
}

export async function removeDocumentFromLibrary(
  libraryId: string,
  documentId: string
): Promise<void> {
  await withLock(async () => {
    const libs = await readLibraries();
    const lib = libs.find((l) => l.id === libraryId);
    if (!lib) return;
    lib.documentIds = lib.documentIds.filter((x) => x !== documentId);
    await writeLibraries(libs);
  });
}

export async function listLibrariesContainingDocument(
  documentId: string
): Promise<{ id: string; name: string }[]> {
  const libs = await readLibraries();
  return libs
    .filter((l) => l.documentIds.includes(documentId))
    .map((l) => ({ id: l.id, name: l.name }));
}

export interface IdbMigrationSource {
  libraries: LibraryRecord[];
  documents: DocumentMeta[];
  exportDocument: (
    id: string
  ) => Promise<(DocumentMeta & { fingerprint: string; data: ArrayBuffer }) | null>;
  listAnnotations: (docId: string) => Promise<AnnotationRecord[]>;
}

export async function importFromIdb(src: IdbMigrationSource): Promise<void> {
  const allAnnotations: AnnotationRecord[] = [];
  const indexEntries: DocIndexEntry[] = [];
  for (const meta of src.documents) {
    const got = await src.exportDocument(meta.id);
    if (!got) continue;
    await api().writeBuffer(pdfPath(got.id), got.data);
    indexEntries.push({
      id: got.id,
      name: got.name,
      size: got.size,
      createdAt: got.createdAt,
      lastOpenedAt: got.lastOpenedAt,
      fingerprint: got.fingerprint,
    });
    const anns = await src.listAnnotations(meta.id);
    allAnnotations.push(...anns);
  }
  await writeDocIndex(indexEntries);
  await writeLibraries([...src.libraries]);
  await writeAnnotations(allAnnotations);
}
