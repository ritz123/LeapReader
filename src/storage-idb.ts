import type { AnnotationRecord, DocumentMeta, LibraryRecord } from "./storage-types";

const DB_NAME = "pdf-split-reader";
const DB_VERSION = 2;
const MAX_STORED_DOCUMENTS = 80;

interface StoredDocument extends DocumentMeta {
  fingerprint: string;
  data: ArrayBuffer;
}

function fingerprint(name: string, size: number, lastModified: number): string {
  return `${name}\u0000${size}\u0000${lastModified}`;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("documents")) {
        const os = db.createObjectStore("documents", { keyPath: "id" });
        os.createIndex("fingerprint", "fingerprint", { unique: false });
        os.createIndex("lastOpenedAt", "lastOpenedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains("libraries")) {
        db.createObjectStore("libraries", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("annotations")) {
        const ann = db.createObjectStore("annotations", { keyPath: "id" });
        ann.createIndex("docId", "docId", { unique: false });
      }
    };
  });
  return dbPromise;
}

export async function getDb(): Promise<IDBDatabase> {
  return openDb();
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("aborted"));
  });
}

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll<T>(store: IDBObjectStore): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const r = store.getAll();
    r.onsuccess = () => resolve((r.result as T[]) ?? []);
    r.onerror = () => reject(r.error);
  });
}

async function pruneOldest(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(["documents", "libraries"], "readwrite");
  const docStore = tx.objectStore("documents");
  const all = await idbGetAll<StoredDocument>(docStore);
  if (all.length <= MAX_STORED_DOCUMENTS) {
    await txDone(tx);
    return;
  }
  const sorted = [...all].sort((a, b) => a.lastOpenedAt - b.lastOpenedAt);
  const removeCount = all.length - MAX_STORED_DOCUMENTS;
  const victims = sorted.slice(0, removeCount);
  const victimIds = new Set(victims.map((v) => v.id));
  const libStore = tx.objectStore("libraries");
  const libs = await idbGetAll<LibraryRecord>(libStore);
  for (const doc of victims) {
    docStore.delete(doc.id);
  }
  for (const lib of libs) {
    const next = lib.documentIds.filter((x) => !victimIds.has(x));
    if (next.length !== lib.documentIds.length) {
      lib.documentIds = next;
      libStore.put(lib);
    }
  }
  await txDone(tx);
}

export async function saveOpenedDocument(
  name: string,
  data: ArrayBuffer,
  lastModified: number
): Promise<string | null> {
  try {
    const db = await getDb();
    const size = data.byteLength;
    const fp = fingerprint(name, size, lastModified);
    const now = Date.now();
    const tx = db.transaction(["documents"], "readwrite");
    const store = tx.objectStore("documents");
    const idx = store.index("fingerprint");
    const matches = (await promisifyRequest(idx.getAll(fp))) as StoredDocument[];
    let id: string;
    let createdAt: number;
    if (matches.length > 0) {
      id = matches[0].id;
      createdAt = matches[0].createdAt;
    } else {
      id = crypto.randomUUID();
      createdAt = now;
    }
    const record: StoredDocument = {
      id,
      name,
      size,
      fingerprint: fp,
      data,
      createdAt,
      lastOpenedAt: now,
    };
    store.put(record);
    await txDone(tx);
    await pruneOldest(db);
    return id;
  } catch (e) {
    console.warn("IndexedDB save failed", e);
    return null;
  }
}

export async function touchDocumentOpened(id: string): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction(["documents"], "readwrite");
    const store = tx.objectStore("documents");
    const r = (await promisifyRequest(store.get(id))) as StoredDocument | undefined;
    if (r) {
      r.lastOpenedAt = Date.now();
      store.put(r);
    }
    await txDone(tx);
  } catch {
    /* ignore */
  }
}

export async function getDocumentData(
  id: string
): Promise<{ name: string; data: ArrayBuffer } | null> {
  try {
    const db = await getDb();
    const tx = db.transaction(["documents"], "readonly");
    const r = (await promisifyRequest(tx.objectStore("documents").get(id))) as
      | StoredDocument
      | undefined;
    await txDone(tx);
    if (!r) return null;
    return { name: r.name, data: r.data };
  } catch {
    return null;
  }
}

/** Full row for migrating desktop storage from IndexedDB to on-disk files. */
export async function exportDocumentForMigration(
  id: string
): Promise<(DocumentMeta & { fingerprint: string; data: ArrayBuffer }) | null> {
  try {
    const db = await getDb();
    const tx = db.transaction(["documents"], "readonly");
    const r = (await promisifyRequest(tx.objectStore("documents").get(id))) as
      | StoredDocument
      | undefined;
    await txDone(tx);
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      size: r.size,
      createdAt: r.createdAt,
      lastOpenedAt: r.lastOpenedAt,
      fingerprint: r.fingerprint,
      data: r.data,
    };
  } catch {
    return null;
  }
}

export async function getDocumentMeta(id: string): Promise<DocumentMeta | null> {
  try {
    const db = await getDb();
    const tx = db.transaction(["documents"], "readonly");
    const r = (await promisifyRequest(tx.objectStore("documents").get(id))) as
      | StoredDocument
      | undefined;
    await txDone(tx);
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      size: r.size,
      createdAt: r.createdAt,
      lastOpenedAt: r.lastOpenedAt,
    };
  } catch {
    return null;
  }
}

export async function listRecentDocuments(limit = 60): Promise<DocumentMeta[]> {
  const db = await getDb();
  const tx = db.transaction(["documents"], "readonly");
  const all = await idbGetAll<StoredDocument>(tx.objectStore("documents"));
  await txDone(tx);
  return all
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
  const db = await getDb();
  if (!db.objectStoreNames.contains("annotations")) return [];
  const tx = db.transaction(["annotations"], "readonly");
  const idx = tx.objectStore("annotations").index("docId");
  const list = (await promisifyRequest(idx.getAll(IDBKeyRange.only(docId)))) as AnnotationRecord[];
  await txDone(tx);
  return list;
}

export async function listAllAnnotations(): Promise<AnnotationRecord[]> {
  const db = await getDb();
  if (!db.objectStoreNames.contains("annotations")) return [];
  const tx = db.transaction(["annotations"], "readonly");
  const all = await idbGetAll<AnnotationRecord>(tx.objectStore("annotations"));
  await txDone(tx);
  return all;
}

export async function putAnnotation(rec: AnnotationRecord): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["annotations"], "readwrite");
  tx.objectStore("annotations").put(rec);
  await txDone(tx);
}

export async function getAnnotation(id: string): Promise<AnnotationRecord | null> {
  try {
    const db = await getDb();
    if (!db.objectStoreNames.contains("annotations")) return null;
    const tx = db.transaction(["annotations"], "readonly");
    const r = (await promisifyRequest(tx.objectStore("annotations").get(id))) as
      | AnnotationRecord
      | undefined;
    await txDone(tx);
    return r ?? null;
  } catch {
    return null;
  }
}

export async function reassignAnnotationsDocId(fromDocId: string, toDocId: string): Promise<void> {
  if (fromDocId === toDocId) return;
  try {
    const db = await getDb();
    if (!db.objectStoreNames.contains("annotations")) return;
    const tx = db.transaction(["annotations"], "readwrite");
    const store = tx.objectStore("annotations");
    const idx = store.index("docId");
    const list = (await promisifyRequest(idx.getAll(fromDocId))) as AnnotationRecord[];
    for (const a of list) {
      store.put({ ...a, docId: toDocId });
    }
    await txDone(tx);
  } catch (e) {
    console.warn("reassignAnnotationsDocId failed", e);
  }
}

export async function updateNoteText(id: string, text: string): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed) return false;
  try {
    const db = await getDb();
    if (!db.objectStoreNames.contains("annotations")) return false;
    const tx = db.transaction(["annotations"], "readwrite");
    const store = tx.objectStore("annotations");
    const r = (await promisifyRequest(store.get(id))) as AnnotationRecord | undefined;
    if (!r || r.kind !== "note") {
      await txDone(tx);
      return false;
    }
    r.text = trimmed;
    store.put(r);
    await txDone(tx);
    return true;
  } catch {
    return false;
  }
}

export async function deleteAnnotation(id: string): Promise<void> {
  const db = await getDb();
  if (!db.objectStoreNames.contains("annotations")) return;
  const tx = db.transaction(["annotations"], "readwrite");
  tx.objectStore("annotations").delete(id);
  await txDone(tx);
}

async function deleteAnnotationsForDocTx(
  annStore: IDBObjectStore,
  docId: string
): Promise<void> {
  if (!annStore.indexNames.contains("docId")) return;
  const idx = annStore.index("docId");
  const keys = (await promisifyRequest(idx.getAllKeys(IDBKeyRange.only(docId)))) as string[];
  for (const k of keys) annStore.delete(k);
}

export async function deleteDocument(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["documents", "libraries", "annotations"], "readwrite");
  const docStore = tx.objectStore("documents");
  const libStore = tx.objectStore("libraries");
  docStore.delete(id);
  await deleteAnnotationsForDocTx(tx.objectStore("annotations"), id);
  const libs = await idbGetAll<LibraryRecord>(libStore);
  for (const lib of libs) {
    if (lib.documentIds.includes(id)) {
      lib.documentIds = lib.documentIds.filter((x) => x !== id);
      libStore.put(lib);
    }
  }
  await txDone(tx);
}

export async function createLibrary(name: string): Promise<LibraryRecord | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const id = crypto.randomUUID();
  const rec: LibraryRecord = { id, name: trimmed, createdAt: Date.now(), documentIds: [] };
  const db = await getDb();
  const tx = db.transaction(["libraries"], "readwrite");
  tx.objectStore("libraries").put(rec);
  await txDone(tx);
  return rec;
}

export async function listLibraries(): Promise<LibraryRecord[]> {
  const db = await getDb();
  const tx = db.transaction(["libraries"], "readonly");
  const all = await idbGetAll<LibraryRecord>(tx.objectStore("libraries"));
  await txDone(tx);
  return all.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export async function getLibrary(id: string): Promise<LibraryRecord | null> {
  const db = await getDb();
  const tx = db.transaction(["libraries"], "readonly");
  const r = (await promisifyRequest(tx.objectStore("libraries").get(id))) as LibraryRecord | undefined;
  await txDone(tx);
  return r ?? null;
}

export async function renameLibrary(id: string, name: string): Promise<boolean> {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const db = await getDb();
  const tx = db.transaction(["libraries"], "readwrite");
  const store = tx.objectStore("libraries");
  const prev = (await promisifyRequest(store.get(id))) as LibraryRecord | undefined;
  if (!prev) {
    await txDone(tx);
    return false;
  }
  prev.name = trimmed;
  store.put(prev);
  await txDone(tx);
  return true;
}

export async function deleteLibrary(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["libraries"], "readwrite");
  tx.objectStore("libraries").delete(id);
  await txDone(tx);
}

export async function addDocumentToLibrary(libraryId: string, documentId: string): Promise<boolean> {
  const db = await getDb();
  const tx = db.transaction(["libraries", "documents"], "readonly");
  const doc = await promisifyRequest(tx.objectStore("documents").get(documentId));
  await txDone(tx);
  if (!doc) return false;
  const tx2 = db.transaction(["libraries"], "readwrite");
  const store = tx2.objectStore("libraries");
  const lib = (await promisifyRequest(store.get(libraryId))) as LibraryRecord | undefined;
  if (!lib) {
    await txDone(tx2);
    return false;
  }
  if (!lib.documentIds.includes(documentId)) {
    lib.documentIds.push(documentId);
    store.put(lib);
  }
  await txDone(tx2);
  return true;
}

export async function removeDocumentFromLibrary(
  libraryId: string,
  documentId: string
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["libraries"], "readwrite");
  const store = tx.objectStore("libraries");
  const lib = (await promisifyRequest(store.get(libraryId))) as LibraryRecord | undefined;
  if (!lib) {
    await txDone(tx);
    return;
  }
  lib.documentIds = lib.documentIds.filter((x) => x !== documentId);
  store.put(lib);
  await txDone(tx);
}

export async function listLibrariesContainingDocument(
  documentId: string
): Promise<{ id: string; name: string }[]> {
  const libs = await listLibraries();
  return libs
    .filter((l) => l.documentIds.includes(documentId))
    .map((l) => ({ id: l.id, name: l.name }));
}
