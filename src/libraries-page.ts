import "./polyfills";
import * as storage from "./storage";
import { formatSize, formatWhen } from "./format-display";
import { postCloseLibrariesEmbed, postOpenDocInReader } from "./reader-bridge";

function isEmbeddedInReader(): boolean {
  try {
    return window.self !== window.top && window.parent.location.origin === window.location.origin;
  } catch {
    return false;
  }
}

function getReaderWindow(): Window | null {
  if (isEmbeddedInReader()) return window.parent;
  const o = window.opener as Window | null;
  if (o && !o.closed) return o;
  return null;
}

function closeLibsDialog(id: string) {
  const d = document.getElementById(id) as HTMLDialogElement | null;
  d?.close();
}

function showToast(message: string) {
  const el = document.getElementById("libs-toast");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  window.setTimeout(() => {
    el.hidden = true;
  }, 2200);
}

let bulkTargetLibraryId: string | null = null;
let removeTargetLibraryId: string | null = null;

const listEl = document.getElementById("libs-page-list") as HTMLDivElement;
const newNameInput = document.getElementById("libs-new-name") as HTMLInputElement;
const btnNewLib = document.getElementById("libs-btn-new-library") as HTMLButtonElement;

const dialogBulk = document.getElementById("dialog-libs-bulk-add") as HTMLDialogElement;
const bulkLibTitle = document.getElementById("libs-bulk-lib-title") as HTMLElement;
const bulkChecklist = document.getElementById("libs-bulk-checklist") as HTMLUListElement;
const bulkEmpty = document.getElementById("libs-bulk-empty") as HTMLParagraphElement;
const btnBulkConfirm = document.getElementById("libs-btn-bulk-add-confirm") as HTMLButtonElement;

const dialogRemove = document.getElementById("dialog-libs-remove-docs") as HTMLDialogElement;
const removeHint = document.getElementById("libs-remove-hint") as HTMLParagraphElement;
const removeChecklist = document.getElementById("libs-remove-checklist") as HTMLUListElement;
const removeEmpty = document.getElementById("libs-remove-empty") as HTMLParagraphElement;
const btnRemoveConfirm = document.getElementById("libs-btn-remove-confirm") as HTMLButtonElement;

async function openInReader(docId: string, pane: "left" | "right" | "auto") {
  const exists = await storage.getDocumentData(docId);
  if (!exists) {
    alert("This file is no longer on this device. Remove it from the library or re-open the file and add it again.");
    void renderLibrariesPage();
    return;
  }
  const target = getReaderWindow();
  if (target) {
    postOpenDocInReader(target, docId, pane);
    if (isEmbeddedInReader()) {
      postCloseLibrariesEmbed(window.parent);
      showToast("Opened in reader");
    } else {
      target.focus();
      showToast("Sent to reader tab");
    }
  } else {
    alert(
      "Open this app from the reader and use Libraries there, or open the reader in another tab first so files can be sent to it."
    );
  }
}

async function buildDocumentRow(
  lib: storage.LibraryRecord,
  docId: string,
  afterMutate: () => void | Promise<void>
): Promise<HTMLLIElement> {
  const meta = await storage.getDocumentMeta(docId);
  const li = document.createElement("li");
  li.className = "doc-list-item";
  if (!meta) {
    const row = document.createElement("div");
    row.className = "doc-list-row";
    const hint = document.createElement("span");
    hint.className = "dialog-hint";
    hint.textContent = "File not in storage — ";
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "btn btn-small";
    rm.textContent = "Remove from library";
    rm.addEventListener("click", async () => {
      await storage.removeDocumentFromLibrary(lib.id, docId);
      await Promise.resolve(afterMutate());
    });
    row.append(hint, rm);
    li.append(row);
    return li;
  }
  const openAuto = () => void openInReader(meta.id, "auto");
  const infoBtn = document.createElement("button");
  infoBtn.type = "button";
  infoBtn.className = "doc-list-info doc-list-open-hit";
  infoBtn.title = "Open in reader";
  const title = document.createElement("span");
  title.className = "doc-list-title";
  title.textContent = meta.name;
  const sub = document.createElement("span");
  sub.className = "doc-list-sub";
  sub.textContent = `${formatWhen(meta.lastOpenedAt)} · ${formatSize(meta.size)}`;
  infoBtn.append(title, sub);
  infoBtn.addEventListener("click", openAuto);
  const actions = document.createElement("div");
  actions.className = "doc-list-actions";
  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "btn primary btn-small";
  openBtn.textContent = "Open";
  openBtn.title = "Open in reader (empty pane, or replace left if both are in use)";
  openBtn.addEventListener("click", openAuto);
  const leftBtn = document.createElement("button");
  leftBtn.type = "button";
  leftBtn.className = "btn btn-small";
  leftBtn.textContent = "Left";
  leftBtn.title = "Open in left pane";
  leftBtn.addEventListener("click", () => void openInReader(meta.id, "left"));
  const rightBtn = document.createElement("button");
  rightBtn.type = "button";
  rightBtn.className = "btn btn-small";
  rightBtn.textContent = "Right";
  rightBtn.title = "Open in right pane";
  rightBtn.addEventListener("click", () => void openInReader(meta.id, "right"));
  const unlinkBtn = document.createElement("button");
  unlinkBtn.type = "button";
  unlinkBtn.className = "btn btn-small";
  unlinkBtn.textContent = "Remove";
  unlinkBtn.title = "Remove from this library only";
  unlinkBtn.addEventListener("click", async () => {
    await storage.removeDocumentFromLibrary(lib.id, docId);
    await Promise.resolve(afterMutate());
  });
  actions.append(openBtn, leftBtn, rightBtn, unlinkBtn);
  li.append(infoBtn, actions);
  return li;
}

async function fillBulkChecklist(libraryId: string) {
  bulkChecklist.replaceChildren();
  const libs = await storage.listLibraries();
  const lib = libs.find((l) => l.id === libraryId);
  const inLib = new Set(lib?.documentIds ?? []);
  let recent: storage.DocumentMeta[] = [];
  try {
    recent = await storage.listRecentDocuments(200);
  } catch {
    /* ignore */
  }
  const available = recent.filter((m) => !inLib.has(m.id));
  bulkEmpty.hidden = available.length > 0;
  for (const m of available) {
    const item = document.createElement("li");
    item.className = "doc-list-item bulk-pick-item";
    const label = document.createElement("label");
    label.className = "bulk-pick-label";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = m.id;
    const span = document.createElement("span");
    span.textContent = m.name;
    label.append(cb, span);
    item.append(label);
    bulkChecklist.append(item);
  }
}

function openBulkAdd(libraryId: string, libraryName: string) {
  bulkTargetLibraryId = libraryId;
  bulkLibTitle.textContent = libraryName;
  void fillBulkChecklist(libraryId).then(() => dialogBulk.showModal());
}

async function openRemoveDocsDialog(libraryId: string, libraryName: string) {
  removeTargetLibraryId = libraryId;
  const lib = await storage.getLibrary(libraryId);
  const ids = lib?.documentIds ?? [];
  removeHint.textContent = `Tick documents to remove from “${libraryName}”. They remain in Recent.`;
  removeChecklist.replaceChildren();
  if (ids.length === 0) {
    removeEmpty.textContent = "This library has no documents.";
    removeEmpty.hidden = false;
    btnRemoveConfirm.disabled = true;
  } else {
    removeEmpty.hidden = true;
    btnRemoveConfirm.disabled = false;
    for (const docId of ids) {
      const meta = await storage.getDocumentMeta(docId);
      const item = document.createElement("li");
      item.className = "doc-list-item bulk-pick-item";
      const label = document.createElement("label");
      label.className = "bulk-pick-label";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = docId;
      const span = document.createElement("span");
      span.textContent = meta?.name ?? "(missing file)";
      label.append(cb, span);
      item.append(label);
      removeChecklist.append(item);
    }
  }
  dialogRemove.showModal();
}

async function renderLibrariesPage() {
  listEl.replaceChildren();
  let libs: storage.LibraryRecord[] = [];
  try {
    libs = await storage.listLibraries();
  } catch {
    /* ignore */
  }
  if (libs.length === 0) {
    const p = document.createElement("p");
    p.className = "dialog-hint";
    p.textContent = "No libraries yet. Enter a name above and tap Create.";
    listEl.append(p);
    return;
  }
  for (const lib of libs) {
    const article = document.createElement("article");
    article.className = "library-card";
    const head = document.createElement("div");
    head.className = "library-card-head";
    const nameSpan = document.createElement("span");
    nameSpan.className = "library-card-title";
    nameSpan.textContent = lib.name;
    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "btn btn-small";
    renameBtn.textContent = "Rename";
    renameBtn.addEventListener("click", async () => {
      const next = prompt("Library name", lib.name);
      if (next === null) return;
      await storage.renameLibrary(lib.id, next);
      void renderLibrariesPage();
    });
    const delLibBtn = document.createElement("button");
    delLibBtn.type = "button";
    delLibBtn.className = "btn btn-small danger";
    delLibBtn.textContent = "Delete library";
    delLibBtn.addEventListener("click", async () => {
      if (!confirm(`Delete library “${lib.name}”? Documents stay in Recent.`)) return;
      await storage.deleteLibrary(lib.id);
      void renderLibrariesPage();
    });
    const addDocsBtn = document.createElement("button");
    addDocsBtn.type = "button";
    addDocsBtn.className = "btn primary btn-small";
    addDocsBtn.textContent = "Add documents…";
    addDocsBtn.addEventListener("click", () => openBulkAdd(lib.id, lib.name));
    const rmDocsBtn = document.createElement("button");
    rmDocsBtn.type = "button";
    rmDocsBtn.className = "btn btn-small";
    rmDocsBtn.textContent = "Remove documents…";
    rmDocsBtn.addEventListener("click", () => {
      void openRemoveDocsDialog(lib.id, lib.name);
    });
    head.append(nameSpan, addDocsBtn, rmDocsBtn, renameBtn, delLibBtn);
    const ul = document.createElement("ul");
    ul.className = "doc-list nested";
    if (lib.documentIds.length === 0) {
      const emptyLi = document.createElement("li");
      emptyLi.className = "dialog-hint";
      emptyLi.textContent = "No documents in this library.";
      ul.append(emptyLi);
    } else {
      for (const docId of lib.documentIds) {
        ul.append(await buildDocumentRow(lib, docId, () => renderLibrariesPage()));
      }
    }
    article.append(head, ul);
    listEl.append(article);
  }
}

btnNewLib.addEventListener("click", async () => {
  const rec = await storage.createLibrary(newNameInput.value);
  newNameInput.value = "";
  if (!rec) return;
  void renderLibrariesPage();
});

btnBulkConfirm.addEventListener("click", async () => {
  if (!bulkTargetLibraryId) return;
  const boxes = bulkChecklist.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked');
  let n = 0;
  for (const cb of boxes) {
    const ok = await storage.addDocumentToLibrary(bulkTargetLibraryId, cb.value);
    if (ok) n += 1;
  }
  if (n === 0) {
    alert("Select at least one document, or they may already be in this library.");
    return;
  }
  showToast(n === 1 ? "Added 1 document" : `Added ${n} documents`);
  bulkTargetLibraryId = null;
  closeLibsDialog("dialog-libs-bulk-add");
  void renderLibrariesPage();
});

btnRemoveConfirm.addEventListener("click", async () => {
  if (!removeTargetLibraryId) return;
  const checked = removeChecklist.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked');
  if (checked.length === 0) {
    alert("Select at least one item.");
    return;
  }
  let n = 0;
  for (const cb of checked) {
    await storage.removeDocumentFromLibrary(removeTargetLibraryId, cb.value);
    n += 1;
  }
  showToast(n === 1 ? "Removed 1 document" : `Removed ${n} documents`);
  removeTargetLibraryId = null;
  closeLibsDialog("dialog-libs-remove-docs");
  void renderLibrariesPage();
});

dialogBulk.addEventListener("close", () => {
  bulkTargetLibraryId = null;
});
dialogRemove.addEventListener("close", () => {
  removeTargetLibraryId = null;
  removeChecklist.replaceChildren();
  btnRemoveConfirm.disabled = false;
});

document.querySelectorAll("[data-libs-close]").forEach((el) => {
  el.addEventListener("click", () => {
    const id = (el as HTMLElement).dataset.libsClose;
    if (id) closeLibsDialog(id);
  });
});

dialogBulk.addEventListener("click", (e) => {
  if (e.target === dialogBulk) dialogBulk.close();
});
dialogRemove.addEventListener("click", (e) => {
  if (e.target === dialogRemove) dialogRemove.close();
});

const backLink = document.getElementById("libs-link-reader") as HTMLAnchorElement | null;
const hintEl = document.getElementById("libs-page-hint");
if (isEmbeddedInReader()) {
  if (hintEl) {
    hintEl.textContent =
      "Tap a document name or Open to load it in the reader (this view closes). Left / Right pick a pane. Escape or ← Reader returns without opening.";
  }
  if (backLink) {
    backLink.href = "#";
    backLink.addEventListener("click", (e) => {
      e.preventDefault();
      postCloseLibrariesEmbed(window.parent);
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      postCloseLibrariesEmbed(window.parent);
    }
  });
}

void renderLibrariesPage();
