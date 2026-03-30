import * as storage from "./storage";
import { formatSize, formatWhen } from "./format-display";
import { showToast } from "./reader/toast";

export type ShelfTargetPane = "left" | "right";

export interface ShelvesDeps {
  /** Close app menu / pane tool panels before opening a dialog (optional). */
  closeChromeFlyouts?: () => void;
  loadPdfFromBytes: (
    data: ArrayBuffer,
    name: string,
    storageId: string | null,
    targetPane: ShelfTargetPane
  ) => Promise<void>;
  loadPdfIntoBothPanes: (data: ArrayBuffer, name: string, storageId: string | null) => Promise<void>;
  areBothPanesEmpty: () => boolean;
  getStorageIdForPane: (pane: ShelfTargetPane) => string | null;
  clearPaneForDeletedStorage: (docId: string) => void | Promise<void>;
}

function closeDialog(el: HTMLDialogElement) {
  el.close();
}


export function initShelvesUi(deps: ShelvesDeps): void {
  let pendingLibraryDocId: string | null = null;
  let removeDocIdForDialog = "";

  const dialogHelp = document.getElementById("dialog-help") as HTMLDialogElement;
  const dialogAbout = document.getElementById("dialog-about") as HTMLDialogElement | null;
  const dialogRecent = document.getElementById("dialog-recent") as HTMLDialogElement;
  const dialogAddLib = document.getElementById("dialog-add-library") as HTMLDialogElement;
  const dialogRemoveLib = document.getElementById("dialog-remove-library") as HTMLDialogElement;
  const dialogMarks = document.getElementById("dialog-marks") as HTMLDialogElement | null;
  const dialogAddNote = document.getElementById("dialog-add-note") as HTMLDialogElement | null;
  const recentList = document.getElementById("recent-list") as HTMLUListElement;
  const recentEmpty = document.getElementById("recent-empty") as HTMLParagraphElement;
  const addLibrarySelect = document.getElementById("add-library-select") as HTMLSelectElement;
  const addDocName = document.getElementById("add-doc-name") as HTMLSpanElement;
  const btnAddLibraryConfirm = document.getElementById("btn-add-library-confirm") as HTMLButtonElement;
  const removeLibDialogTitle = document.getElementById("remove-lib-dialog-title") as HTMLElement;
  const removeLibDialogHint = document.getElementById("remove-lib-dialog-hint") as HTMLElement;
  const removeLibChecklist = document.getElementById("remove-lib-checklist") as HTMLUListElement;
  const removeLibEmpty = document.getElementById("remove-lib-empty") as HTMLParagraphElement;
  const btnRemoveLibConfirm = document.getElementById("btn-remove-lib-confirm") as HTMLButtonElement;

  async function openRemoveDocumentFromLibraries(docId: string, displayName: string) {
    removeDocIdForDialog = docId;
    let containing: { id: string; name: string }[] = [];
    try {
      containing = await storage.listLibrariesContainingDocument(docId);
    } catch {
      /* ignore */
    }
    removeLibDialogTitle.textContent = "Remove from library";
    removeLibDialogHint.textContent = `Tick each library you want to remove “${displayName}” from. The file stays in Recent.`;
    removeLibChecklist.replaceChildren();
    if (containing.length === 0) {
      removeLibEmpty.textContent = "This document is not in any library.";
      removeLibEmpty.hidden = false;
      btnRemoveLibConfirm.disabled = true;
    } else {
      removeLibEmpty.hidden = true;
      btnRemoveLibConfirm.disabled = false;
      for (const L of containing) {
        const li = document.createElement("li");
        li.className = "doc-list-item bulk-pick-item";
        const label = document.createElement("label");
        label.className = "bulk-pick-label";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.value = L.id;
        const span = document.createElement("span");
        span.textContent = L.name;
        label.append(cb, span);
        li.append(label);
        removeLibChecklist.append(li);
      }
    }
    dialogRemoveLib.showModal();
  }

  function openChooseLibraryForDocument(docId: string, displayName: string) {
    pendingLibraryDocId = docId;
    addDocName.textContent = displayName;
    void fillAddLibrarySelect().then(() => dialogAddLib.showModal());
  }

  async function fillRecentList() {
    recentList.replaceChildren();
    let items: storage.DocumentMeta[] = [];
    try {
      items = await storage.listRecentDocuments();
    } catch {
      /* ignore */
    }
    recentEmpty.hidden = items.length > 0;
    for (const meta of items) {
      const li = document.createElement("li");
      li.className = "doc-list-item";
      const info = document.createElement("div");
      info.className = "doc-list-info";
      const title = document.createElement("span");
      title.className = "doc-list-title";
      title.textContent = meta.name;
      const sub = document.createElement("span");
      sub.className = "doc-list-sub";
      sub.textContent = `${formatWhen(meta.lastOpenedAt)} · ${formatSize(meta.size)}`;
      info.append(title, sub);
      const actions = document.createElement("div");
      actions.className = "doc-list-actions";
      function wireOpenButton(btn: HTMLButtonElement, pane: ShelfTargetPane, label: string) {
        btn.type = "button";
        btn.className = "btn btn-small";
        btn.textContent = label;
        btn.title = pane === "left" ? "Open in left pane" : "Open in right pane";
        btn.addEventListener("click", async () => {
          const got = await storage.getDocumentData(meta.id);
          if (!got) {
            alert("This file is no longer in storage.");
            void fillRecentList();
            return;
          }
          await storage.touchDocumentOpened(meta.id);
          if (deps.areBothPanesEmpty()) {
            await deps.loadPdfIntoBothPanes(got.data, got.name, meta.id);
          } else {
            await deps.loadPdfFromBytes(got.data, got.name, meta.id, pane);
          }
          void storage.ensureDocumentInImportedLibrary(meta.id);
          // emitPaneDocChanged (from loadPdf*) already updates the library button.
          closeDialog(dialogRecent);
        });
      }
      const openLeftBtn = document.createElement("button");
      wireOpenButton(openLeftBtn, "left", "Left");
      const openRightBtn = document.createElement("button");
      wireOpenButton(openRightBtn, "right", "Right");
      const addLibBtn = document.createElement("button");
      addLibBtn.type = "button";
      addLibBtn.className = "btn btn-small";
      addLibBtn.textContent = "Add to library…";
      addLibBtn.addEventListener("click", () => {
        openChooseLibraryForDocument(meta.id, meta.name);
      });
      const rmLibBtn = document.createElement("button");
      rmLibBtn.type = "button";
      rmLibBtn.className = "btn btn-small";
      rmLibBtn.textContent = "Remove from library…";
      rmLibBtn.addEventListener("click", () => {
        void openRemoveDocumentFromLibraries(meta.id, meta.name);
      });
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn btn-small danger";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", async () => {
        if (!confirm(`Remove “${meta.name}” from this device?`)) return;
        await storage.deleteDocument(meta.id);
        void deps.clearPaneForDeletedStorage(meta.id);
        void fillRecentList();
      });
      actions.append(openLeftBtn, openRightBtn, addLibBtn, rmLibBtn, delBtn);
      li.append(info, actions);
      recentList.append(li);
    }
  }

  async function fillAddLibrarySelect() {
    addLibrarySelect.replaceChildren();
    const libs = await storage.listLibraries();
    if (libs.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Create a library first (Libraries tab)";
      opt.disabled = true;
      opt.selected = true;
      addLibrarySelect.append(opt);
      btnAddLibraryConfirm.disabled = true;
      return;
    }
    btnAddLibraryConfirm.disabled = false;
    for (const lib of libs) {
      const opt = document.createElement("option");
      opt.value = lib.id;
      opt.textContent = lib.name;
      addLibrarySelect.append(opt);
    }
  }


  document.getElementById("btn-recent")?.addEventListener("click", () => {
    deps.closeChromeFlyouts?.();
    void fillRecentList().then(() => dialogRecent.showModal());
  });

  function wirePaneLibraryToolbar(pane: ShelfTargetPane) {
    const addId = `btn-add-library-${pane}`;
    const remId = `btn-remove-library-${pane}`;
    document.getElementById(addId)?.addEventListener("click", async () => {
      const id = deps.getStorageIdForPane(pane);
      if (!id) {
        alert("Save this document to Recent first (re-open the file if Add to library stays disabled).");
        return;
      }
      const meta = await storage.getDocumentMeta(id);
      openChooseLibraryForDocument(id, meta?.name ?? "this document");
    });
    document.getElementById(remId)?.addEventListener("click", async () => {
      const id = deps.getStorageIdForPane(pane);
      if (!id) {
        alert("Save this document to Recent first (re-open the file if this action stays disabled).");
        return;
      }
      const meta = await storage.getDocumentMeta(id);
      await openRemoveDocumentFromLibraries(id, meta?.name ?? "this document");
    });
  }
  wirePaneLibraryToolbar("left");
  wirePaneLibraryToolbar("right");

  btnAddLibraryConfirm.addEventListener("click", async () => {
    const docId = pendingLibraryDocId;
    const libId = addLibrarySelect.value;
    if (!docId || !libId) return;
    const ok = await storage.addDocumentToLibrary(libId, docId);
    if (!ok) {
      alert("Could not add to that library.");
      return;
    }
    pendingLibraryDocId = null;
    showToast("Added to library");
    closeDialog(dialogAddLib);
  });

  btnRemoveLibConfirm.addEventListener("click", async () => {
    const checked = removeLibChecklist.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked');
    if (checked.length === 0) {
      alert("Select at least one item.");
      return;
    }
    const docId = removeDocIdForDialog;
    if (!docId) return;
    let n = 0;
    for (const cb of checked) {
      await storage.removeDocumentFromLibrary(cb.value, docId);
      n += 1;
    }
    showToast(n === 1 ? "Removed from 1 library" : `Removed from ${n} libraries`);
    removeDocIdForDialog = "";
    closeDialog(dialogRemoveLib);
  });

  dialogAddLib.addEventListener("close", () => {
    pendingLibraryDocId = null;
  });
  dialogRemoveLib.addEventListener("close", () => {
    removeDocIdForDialog = "";
    removeLibChecklist.replaceChildren();
    btnRemoveLibConfirm.disabled = false;
  });

  document.querySelectorAll("[data-close-dialog]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = (el as HTMLElement).dataset.closeDialog;
      if (id === "dialog-recent") closeDialog(dialogRecent);
      if (id === "dialog-add-library") closeDialog(dialogAddLib);
      if (id === "dialog-remove-library") closeDialog(dialogRemoveLib);
      if (id === "dialog-marks" && dialogMarks) closeDialog(dialogMarks);
      if (id === "dialog-help") closeDialog(dialogHelp);
      if (id === "dialog-about" && dialogAbout) closeDialog(dialogAbout);
      if (id === "dialog-add-note" && dialogAddNote) closeDialog(dialogAddNote);
    });
  });

  dialogHelp.addEventListener("click", (e) => {
    if (e.target === dialogHelp) dialogHelp.close();
  });
  dialogAbout?.addEventListener("click", (e) => {
    if (e.target === dialogAbout) dialogAbout.close();
  });

  dialogRecent.addEventListener("click", (e) => {
    if (e.target === dialogRecent) dialogRecent.close();
  });
  dialogAddLib.addEventListener("click", (e) => {
    if (e.target === dialogAddLib) dialogAddLib.close();
  });
  dialogRemoveLib.addEventListener("click", (e) => {
    if (e.target === dialogRemoveLib) dialogRemoveLib.close();
  });
  dialogMarks?.addEventListener("click", (e) => {
    if (e.target === dialogMarks) dialogMarks.close();
  });
  dialogAddNote?.addEventListener("click", (e) => {
    if (e.target === dialogAddNote) dialogAddNote.close();
  });
}
