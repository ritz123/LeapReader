import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";

/**
 * At most two parsed PDFs in memory (matching left/right panes). Same logical document
 * in both panes shares one {@link PDFDocumentProxy} — one parse, two references.
 *
 * Random access to pages uses pdf.js: `proxy.getPage(n)` (xref / page tree after load).
 */
export const MAX_LOADED_PDFS = 2;

type PoolEntry = { proxy: PDFDocumentProxy; refCount: number };

const pool = new Map<string, PoolEntry>();

/** Free slots where refcount hit zero (defensive cleanup). */
function evictDereferenced(): void {
  for (const [key, entry] of [...pool]) {
    if (entry.refCount <= 0) {
      void entry.proxy.destroy();
      pool.delete(key);
    }
  }
}

/** Drop zero-ref entries until there is room for one more distinct key. */
function makeRoomIfPossible(): void {
  while (pool.size >= MAX_LOADED_PDFS) {
    const victim = [...pool.entries()].find(([, e]) => e.refCount === 0);
    if (!victim) return;
    void victim[1].proxy.destroy();
    pool.delete(victim[0]);
  }
}

/**
 * Obtain a shared {@link PDFDocumentProxy} for `key`.
 * - If already loaded: increment refcount and return the same proxy (no re-parse).
 * - Otherwise parse `data` (required for new keys).
 */
export async function acquirePdfDoc(key: string, data?: ArrayBuffer): Promise<PDFDocumentProxy> {
  if (!key) {
    throw new Error("pdf-doc-pool: key required");
  }

  const existing = pool.get(key);
  if (existing) {
    existing.refCount++;
    return existing.proxy;
  }

  if (!data?.byteLength) {
    throw new Error(`pdf-doc-pool: unknown key "${key}" requires non-empty ArrayBuffer`);
  }

  makeRoomIfPossible();
  evictDereferenced();

  if (pool.size >= MAX_LOADED_PDFS) {
    throw new Error(
      "pdf-doc-pool: two PDFs still open — close or replace one pane before loading another file"
    );
  }

  const proxy = await pdfjsLib.getDocument({
    data: new Uint8Array(data),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  pool.set(key, { proxy, refCount: 1 });
  return proxy;
}

/** Release one reference; destroy the proxy when the last pane lets go. */
export async function releasePdfDoc(key: string): Promise<void> {
  if (!key) return;
  const entry = pool.get(key);
  if (!entry) return;
  entry.refCount--;
  if (entry.refCount <= 0) {
    await entry.proxy.destroy();
    pool.delete(key);
  }
}
