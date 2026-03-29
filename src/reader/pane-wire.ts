import { ZOOM_STEP } from "./config";
import { bumpContinuousRev } from "./continuous-helpers";
import { updateNavDisabled } from "./chrome-toolbar";
import { getPane } from "./dom";
import { hideSelectionFloat } from "./selection-geometry";
import { openAddNoteDialog } from "./notes-dialog";
import { scrollContinuousToPage } from "./pdf-continuous";
import { renderPane } from "./render-registry";
import { session } from "./session";
import type { PaneSide } from "./types";
import { adjustPaneZoom } from "./zoom-pane";

export function wirePane(side: PaneSide): void {
  const p = getPane(side);

  const schedule = () => {
    void renderPane(side);
  };

  p.pageInput.addEventListener("change", () => {
    if (session.paneScrollMode[side] === "continuous") {
      const v = Math.min(
        Math.max(1, parseInt(p.pageInput.value, 10) || 1),
        session.paneState[side].doc?.numPages ?? 1
      );
      p.pageInput.value = String(v);
      scrollContinuousToPage(side, v);
      updateNavDisabled();
      return;
    }
    schedule();
  });
  p.pageInput.addEventListener("input", () => updateNavDisabled());

  p.prevBtn.addEventListener("click", () => {
    let v = parseInt(p.pageInput.value, 10) || 1;
    v = Math.max(1, v - 1);
    p.pageInput.value = String(v);
    if (session.paneScrollMode[side] === "continuous") {
      scrollContinuousToPage(side, v);
      updateNavDisabled();
      return;
    }
    schedule();
  });

  p.nextBtn.addEventListener("click", () => {
    const n = session.paneState[side].doc?.numPages ?? 1;
    let v = parseInt(p.pageInput.value, 10) || 1;
    v = Math.min(n, v + 1);
    p.pageInput.value = String(v);
    if (session.paneScrollMode[side] === "continuous") {
      scrollContinuousToPage(side, v);
      updateNavDisabled();
      return;
    }
    schedule();
  });

  const wheelThrottleMs = 220;
  p.canvasScroll.addEventListener("scroll", () => hideSelectionFloat(), { passive: true });

  p.canvasScroll.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (!session.paneState[side].doc) return;
        e.preventDefault();
        const dy = e.deltaY;
        if (dy === 0) return;
        const factor = dy > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
        adjustPaneZoom(side, factor);
        return;
      }
      if (session.paneScrollMode[side] === "continuous") {
        return;
      }
      const doc = session.paneState[side].doc;
      if (!doc) return;
      const dy = e.deltaY;
      const dx = e.deltaX;
      if (Math.abs(dy) < Math.abs(dx)) return;
      if (dy === 0) return;
      e.preventDefault();
      const now = performance.now();
      const last = session.paneWheelNavAt.get(side) ?? 0;
      if (now - last < wheelThrottleMs) return;
      const n = doc.numPages;
      let v = parseInt(p.pageInput.value, 10) || 1;
      const next = dy > 0 ? Math.min(n, v + 1) : Math.max(1, v - 1);
      if (next === v) return;
      session.paneWheelNavAt.set(side, now);
      p.pageInput.value = String(next);
      updateNavDisabled();
      schedule();
    },
    { passive: false }
  );

  p.canvasScroll.addEventListener("pointerdown", (e) => {
    const st = session.paneState[side];
    if (!session.noteMode || !st.doc || !st.annotationDocId) return;
    const vp = (e.target as HTMLElement).closest(".page-viewport");
    if (!vp || !p.root.contains(vp)) return;
    if ((e.target as HTMLElement).closest(".ann-note-pin")) return;
    e.preventDefault();
    const rect = vp.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const slot = vp.closest<HTMLElement>("[data-pdf-page]");
    const pageNum = slot
      ? parseInt(slot.dataset.pdfPage ?? "1", 10)
      : Math.min(
          Math.max(1, parseInt(p.pageInput.value, 10) || 1),
          st.doc?.numPages ?? 1
        );
    openAddNoteDialog(side, pageNum, x, y);
  });

  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  const ro = new ResizeObserver(() => {
    if (!session.paneState[side].doc) return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      const wrap = p.canvasWrap;
      const w = Math.round(wrap.clientWidth);
      const h = Math.round(wrap.clientHeight);
      const snap = session.paneLayoutSnapshot.get(side);
      if (snap && snap.w === w && snap.h === h) return;
      if (session.paneScrollMode[side] === "continuous") bumpContinuousRev(side);
      void renderPane(side);
    }, 200);
  });
  ro.observe(p.canvasWrap);
}
