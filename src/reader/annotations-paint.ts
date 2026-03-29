import {
  HIGHLIGHT_PRINT_OPAQUE,
  highlightBackgroundForStored,
  highlightColorIdForStored,
} from "../highlight-colors";
import * as storage from "../storage";
import { getPane } from "./dom";
import { session } from "./session";
import type { PaneSide } from "./types";

let onOpenNoteForEdit: (id: string) => void = () => {};

export function setOpenNoteForEditHandler(fn: (id: string) => void): void {
  onOpenNoteForEdit = fn;
}

export function getAnnotationLayers(
  side: PaneSide,
  pageNum: number
): { highlights: HTMLElement; notes: HTMLElement } | null {
  if (session.paneScrollMode[side] === "continuous") {
    const slot = getPane(side).continuousStack.querySelector<HTMLElement>(
      `.continuous-page-slot[data-pdf-page="${pageNum}"]`
    );
    if (!slot) return null;
    const vp = slot.querySelector<HTMLElement>(".page-viewport");
    if (!vp) return null;
    const highlights = vp.querySelector<HTMLElement>(".annotation-highlights");
    const notes = vp.querySelector<HTMLElement>(".annotation-notes");
    if (!highlights || !notes) return null;
    return { highlights, notes };
  }
  const p = getPane(side);
  const cur = Math.min(
    Math.max(1, parseInt(p.pageInput.value, 10) || 1),
    session.paneState[side].doc?.numPages ?? 1
  );
  if (cur !== pageNum) return null;
  return { highlights: p.highlightsLayer, notes: p.notesLayer };
}

export async function paintAnnotations(side: PaneSide, pageNum: number): Promise<void> {
  const layers = getAnnotationLayers(side, pageNum);
  if (!layers) return;
  layers.highlights.replaceChildren();
  layers.notes.replaceChildren();
  const annId = session.paneState[side].annotationDocId;
  if (!annId) return;
  let items: storage.AnnotationRecord[] = [];
  try {
    items = await storage.listAnnotations(annId);
  } catch {
    return;
  }
  const forPane = items.filter((a) => a.pane === side && a.page === pageNum);
  for (const a of forPane) {
    if (a.kind === "highlight" && a.rects) {
      for (const r of a.rects) {
        const d = document.createElement("div");
        d.className = "ann-highlight";
        const hlId = highlightColorIdForStored(a.color);
        d.dataset.hlColor = hlId;
        d.style.background = highlightBackgroundForStored(a.color);
        d.style.setProperty("--ann-hl-print", HIGHLIGHT_PRINT_OPAQUE[hlId]);
        d.style.left = `${r.l * 100}%`;
        d.style.top = `${r.t * 100}%`;
        d.style.width = `${r.w * 100}%`;
        d.style.height = `${r.h * 100}%`;
        layers.highlights.append(d);
      }
    } else if (a.kind === "note" && a.x != null && a.y != null) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ann-note-pin";
      b.textContent = "●";
      b.style.left = `${a.x * 100}%`;
      b.style.top = `${a.y * 100}%`;
      b.title = (a.text ?? "Note").slice(0, 200);
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        onOpenNoteForEdit(a.id);
      });
      layers.notes.append(b);
    }
  }
}
