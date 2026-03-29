import * as storage from "../storage";
import { paintAnnotations } from "./annotations-paint";
import {
  docLabelForAnnotationDocId,
  showToast,
  syncNoteModeButton,
  updateSelectionButtons,
} from "./chrome-toolbar";
import { truncateTitle } from "./dom";
import { closeAllPaneFlyouts } from "./flyouts";
import { closeHighlightColorPopover } from "./highlight-picker";
import { renderBothPanes } from "./render-registry";
import {
  getSelectionInViewport,
  hideSelectionFloat,
  viewportAndPageFromSelection,
} from "./selection-geometry";
import { session } from "./session";
import type { PaneSide } from "./types";

export function syncNoteDialogMode(mode: "add" | "edit"): void {
  const title = document.getElementById("dialog-note-title");
  const delBtn = document.getElementById("dialog-note-delete") as HTMLButtonElement | null;
  if (title) title.textContent = mode === "add" ? "Add note" : "Edit note";
  if (delBtn) delBtn.hidden = mode === "add";
}

export async function openEditNoteDialog(annotationId: string): Promise<void> {
  const a = await storage.getAnnotation(annotationId);
  if (!a || a.kind !== "note") return;
  session.noteDialogEditingId = a.id;
  session.noteDialogEditContext = { pane: a.pane, page: a.page };
  session.pendingNotePlacement = null;
  session.noteMode = false;
  syncNoteModeButton();
  updateSelectionButtons();
  closeHighlightColorPopover();
  closeAllPaneFlyouts();
  syncNoteDialogMode("edit");
  const refEl = document.getElementById("dialog-note-ref");
  if (refEl) {
    const docLab = docLabelForAnnotationDocId(a.docId);
    const paneLab = a.pane === "left" ? "Left" : "Right";
    const st = session.paneState[a.pane];
    const np = st.doc?.numPages;
    refEl.textContent = np
      ? `${docLab} · ${paneLab} pane · Page ${a.page} of ${np}`
      : `${docLab} · ${paneLab} pane · Page ${a.page}`;
  }
  const ta = document.getElementById("dialog-note-text") as HTMLTextAreaElement | null;
  if (ta) ta.value = a.text ?? "";
  const d = document.getElementById("dialog-add-note") as HTMLDialogElement | null;
  if (!d) return;
  d.showModal();
  requestAnimationFrame(() => ta?.focus());
}

export function openAddNoteDialog(side: PaneSide, pageNum: number, x: number, y: number): void {
  const st = session.paneState[side];
  if (!st.doc || !st.annotationDocId) return;
  session.noteDialogEditingId = null;
  session.noteDialogEditContext = null;
  syncNoteDialogMode("add");
  session.noteMode = false;
  syncNoteModeButton();
  updateSelectionButtons();
  hideSelectionFloat();
  session.pendingNotePlacement = { side, pageNum, x, y };
  closeHighlightColorPopover();
  closeAllPaneFlyouts();
  const refEl = document.getElementById("dialog-note-ref");
  if (refEl) {
    const docLabel = truncateTitle((st.name || "").trim() || "Untitled document", 56);
    const paneLabel = side === "left" ? "Left" : "Right";
    const np = st.doc.numPages;
    refEl.textContent = `${docLabel} · ${paneLabel} pane · Page ${pageNum} of ${np}`;
  }
  const ta = document.getElementById("dialog-note-text") as HTMLTextAreaElement | null;
  if (ta) ta.value = "";
  const d = document.getElementById("dialog-add-note") as HTMLDialogElement | null;
  if (!d) return;
  d.showModal();
  requestAnimationFrame(() => {
    ta?.focus();
  });
}

export async function submitNoteDialog(): Promise<void> {
  const ta = document.getElementById("dialog-note-text") as HTMLTextAreaElement | null;
  const text = (ta?.value ?? "").trim();
  const d = document.getElementById("dialog-add-note") as HTMLDialogElement | null;
  if (!d) return;

  if (session.noteDialogEditingId && session.noteDialogEditContext) {
    if (!text) {
      showToast("Note cannot be empty");
      ta?.focus();
      return;
    }
    try {
      const ok = await storage.updateNoteText(session.noteDialogEditingId, text);
      if (!ok) throw new Error("update failed");
      const ctx = session.noteDialogEditContext;
      session.noteDialogEditingId = null;
      session.noteDialogEditContext = null;
      d.close();
      await paintAnnotations(ctx.pane, ctx.page);
      void renderBothPanes();
      showToast("Note updated");
    } catch (err) {
      console.error(err);
      alert("Could not update this note.");
    }
    return;
  }

  const p = session.pendingNotePlacement;
  if (!p) return;
  if (!text) {
    showToast("Write a note first");
    ta?.focus();
    return;
  }
  const st = session.paneState[p.side];
  if (!st.annotationDocId) return;
  try {
    await storage.putAnnotation({
      id: crypto.randomUUID(),
      docId: st.annotationDocId,
      pane: p.side,
      page: p.pageNum,
      kind: "note",
      createdAt: Date.now(),
      text,
      x: p.x,
      y: p.y,
    });
    session.pendingNotePlacement = null;
    d.close();
    await paintAnnotations(p.side, p.pageNum);
    void renderBothPanes();
    showToast("Note saved");
  } catch (err) {
    console.error(err);
    alert("Could not save this note.");
  }
}

export async function deleteNoteFromDialog(): Promise<void> {
  const id = session.noteDialogEditingId;
  const ctx = session.noteDialogEditContext;
  if (!id || !ctx) return;
  if (!confirm("Delete this note?")) return;
  try {
    await storage.deleteAnnotation(id);
    session.noteDialogEditingId = null;
    session.noteDialogEditContext = null;
    (document.getElementById("dialog-add-note") as HTMLDialogElement).close();
    void renderBothPanes();
    showToast("Note deleted");
  } catch (err) {
    console.error(err);
    alert("Could not delete this note.");
  }
}

export function openNoteAtSelection(side: PaneSide): void {
  const hit = viewportAndPageFromSelection(side);
  if (!hit) return;
  const range = getSelectionInViewport(hit.vp);
  if (!range) return;
  const br = range.getBoundingClientRect();
  const vr = hit.vp.getBoundingClientRect();
  if (vr.width < 1 || vr.height < 1) return;
  const x = (br.left + br.width / 2 - vr.left) / vr.width;
  const y = (br.top + br.height / 2 - vr.top) / vr.height;
  openAddNoteDialog(side, hit.pageNum, Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y)));
}
