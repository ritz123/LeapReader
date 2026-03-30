import { highlightBackgroundForStored } from "../highlight-colors";
import * as storage from "../storage";
import { getPane, truncateTitle } from "./dom";
import {
  getActivePaneTab,
  isTabLayoutActive,
  setActivePaneTab,
} from "./layout-controller";
import { notifyAfterLayoutChange } from "./lifecycle";
import { openEditNoteDialog } from "./notes-dialog";
import { scrollContinuousToPage } from "./pdf-continuous";
import { loadPdfBuffer } from "./pdf-session";
import { renderBothPanes, renderPane } from "./render-registry";
import { session } from "./session";

export async function goToAnnotationMark(a: storage.AnnotationRecord): Promise<boolean> {
  try {
    if (isTabLayoutActive() && getActivePaneTab() !== a.pane) {
      setActivePaneTab(a.pane);
      notifyAfterLayoutChange();
    }
    const st = session.paneState[a.pane];
    const already = st.annotationDocId === a.docId && st.doc;
    if (!already) {
      const got = await storage.getDocumentData(a.docId);
      if (!got) {
        alert("This file is no longer in storage.");
        return false;
      }
      await storage.touchDocumentOpened(a.docId);
      await loadPdfBuffer(got.data, got.name, a.docId, a.pane);
    } else {
      await storage.touchDocumentOpened(a.docId);
    }
    getPane(a.pane).pageInput.value = String(a.page);
    await renderPane(a.pane);
    if (session.paneScrollMode[a.pane] === "continuous") {
      scrollContinuousToPage(a.pane, a.page);
    }
    // loadPdfBuffer already emits emitPaneDocChanged which updates all chrome.
    return true;
  } catch (e) {
    console.error(e);
    alert("Could not open this mark's document.");
    return false;
  }
}

export async function refreshMarksDialog(): Promise<void> {
  const ul = document.getElementById("marks-list") as HTMLUListElement | null;
  const empty = document.getElementById("marks-empty") as HTMLParagraphElement | null;
  if (!ul || !empty) return;
  ul.replaceChildren();
  let items: storage.AnnotationRecord[] = [];
  try {
    items = await storage.listAllAnnotations();
  } catch {
    empty.hidden = false;
    return;
  }
  const metaById = new Map<string, string>();
  try {
    for (const m of await storage.listRecentDocuments(500)) {
      metaById.set(m.id, m.name);
    }
  } catch {
    /* ignore */
  }
  function docTitleForMark(docId: string): string {
    const n = metaById.get(docId);
    if (n) return truncateTitle(n, 36);
    if (docId.startsWith("unsaved:")) {
      const rest = docId.slice("unsaved:".length);
      const namePart = rest.split(":")[0] ?? "";
      return truncateTitle(namePart || "Unsaved", 36);
    }
    return "Unknown document";
  }
  empty.hidden = items.length > 0;
  const sorted = items
    .map((ann) => ({ ann, docTitle: docTitleForMark(ann.docId) }))
    .sort((x, y) => {
      const c = x.docTitle.localeCompare(y.docTitle, undefined, { sensitivity: "base" });
      if (c !== 0) return c;
      if (x.ann.page !== y.ann.page) return x.ann.page - y.ann.page;
      if (x.ann.pane !== y.ann.pane) return x.ann.pane.localeCompare(y.ann.pane);
      return x.ann.createdAt - y.ann.createdAt;
    });
  for (const { ann: a, docTitle } of sorted) {
    const li = document.createElement("li");
    li.className = "doc-list-item";
    const info = document.createElement("div");
    info.className = "doc-list-info";
    const titleRow = document.createElement("div");
    titleRow.className = "marks-title-row";
    if (a.kind === "highlight") {
      const dot = document.createElement("span");
      dot.className = "marks-hl-dot";
      dot.style.background = highlightBackgroundForStored(a.color);
      dot.title = "Highlight color";
      titleRow.append(dot);
    }
    const t = document.createElement("span");
    t.className = "doc-list-title";
    t.textContent =
      a.kind === "highlight"
        ? `Highlight · ${docTitle} · p${a.page} (${a.pane})`
        : `Note · ${docTitle} · p${a.page} (${a.pane})`;
    titleRow.append(t);
    const sub = document.createElement("span");
    sub.className = "doc-list-sub";
    const snippet = a.kind === "highlight" ? (a.quote ?? "") : (a.text ?? "");
    sub.textContent = snippet.slice(0, 140) + (snippet.length > 140 ? "…" : "");
    info.append(titleRow, sub);
    const actions = document.createElement("div");
    actions.className = "doc-list-actions";
    const gotoBtn = document.createElement("button");
    gotoBtn.type = "button";
    gotoBtn.className = "btn btn-small";
    gotoBtn.textContent = "Go";
    gotoBtn.addEventListener("click", async () => {
      const ok = await goToAnnotationMark(a);
      if (ok) (document.getElementById("dialog-marks") as HTMLDialogElement).close();
    });
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "btn btn-small";
    edit.textContent = "Edit";
    edit.hidden = a.kind !== "note";
    edit.addEventListener("click", () => {
      void (async () => {
        if (a.kind !== "note") return;
        (document.getElementById("dialog-marks") as HTMLDialogElement).close();
        const ok = await goToAnnotationMark(a);
        if (ok) void openEditNoteDialog(a.id);
      })();
    });
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn-small danger";
    del.textContent = "Delete";
    del.addEventListener("click", async () => {
      await storage.deleteAnnotation(a.id);
      void refreshMarksDialog();
      void renderBothPanes();
    });
    actions.append(gotoBtn, edit, del);
    li.append(info, actions);
    ul.append(li);
  }
}
