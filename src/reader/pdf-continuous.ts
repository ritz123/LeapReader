import { TextLayer } from "pdfjs-dist";
import { paintAnnotations } from "./annotations-paint";
import { updateNavDisabled } from "./chrome-toolbar";
import { continuousLayerKey } from "./continuous-helpers";
import { getPane, waitLayout } from "./dom";
import { bindTextLayerScale, getScaledPageViewport } from "./pdf-viewport";
import { session } from "./session";
import type { PaneSide } from "./types";
import { syncZoomUi } from "./zoom-pane";

export function teardownContinuousUi(side: PaneSide): void {
  session.continuousObservers.get(side)?.disconnect();
  session.continuousObservers.delete(side);
  const fn = session.continuousScrollHandler[side];
  if (fn) {
    getPane(side).canvasScroll.removeEventListener("scroll", fn);
    delete session.continuousScrollHandler[side];
  }
  const stack = getPane(side).continuousStack;
  stack.replaceChildren();
  stack.hidden = true;
  for (const [k, tl] of session.continuousTextLayers) {
    if (k.startsWith(`${side}-`)) {
      tl?.cancel();
      session.continuousTextLayers.delete(k);
    }
  }
  for (const k of session.continuousSlotRenderTail.keys()) {
    if (k.startsWith(`${side}-`)) session.continuousSlotRenderTail.delete(k);
  }
  session.continuousBuiltRev[side] = -1;
  const sh = getPane(side).singlePageShell;
  sh.hidden = false;
}

function syncContinuousScrollPageInput(side: PaneSide): void {
  if (session.paneScrollMode[side] !== "continuous") return;
  if (session.continuousScrollRaf != null) return;
  session.continuousScrollRaf = requestAnimationFrame(() => {
    session.continuousScrollRaf = null;
    const p = getPane(side);
    const scrollEl = p.canvasScroll;
    const slots = p.continuousStack.querySelectorAll<HTMLElement>(".continuous-page-slot");
    if (slots.length === 0) return;
    const sr = scrollEl.getBoundingClientRect();
    let bestPage = 1;
    let bestVis = 0;
    for (const slot of slots) {
      const r = slot.getBoundingClientRect();
      const vis = Math.max(0, Math.min(r.bottom, sr.bottom) - Math.max(r.top, sr.top));
      if (vis > bestVis) {
        bestVis = vis;
        bestPage = parseInt(slot.dataset.pdfPage ?? "1", 10);
      }
    }
    const cur = parseInt(p.pageInput.value, 10) || 1;
    if (cur !== bestPage) {
      p.pageInput.value = String(bestPage);
      updateNavDisabled();
    }
  });
}

function continuousViewportPadPx(side: PaneSide): number {
  const h = getPane(side).canvasScroll.clientHeight;
  return Math.max(480, Math.round(h * 0.9));
}

function isContinuousSlotInRenderRange(
  slot: HTMLElement,
  scrollEl: HTMLElement,
  padPx: number
): boolean {
  const r = slot.getBoundingClientRect();
  const root = scrollEl.getBoundingClientRect();
  return r.bottom >= root.top - padPx && r.top <= root.bottom + padPx;
}

function ensureContinuousSlotsRendered(side: PaneSide): void {
  if (session.paneScrollMode[side] !== "continuous") return;
  const p = getPane(side);
  const pad = continuousViewportPadPx(side);
  const scrollEl = p.canvasScroll;
  for (const slot of p.continuousStack.querySelectorAll<HTMLElement>(".continuous-page-slot")) {
    if (isContinuousSlotInRenderRange(slot, scrollEl, pad)) {
      void renderContinuousSlotContent(side, slot);
    }
  }
}

function attachContinuousScrollSync(side: PaneSide): void {
  if (session.continuousScrollHandler[side]) return;
  const fn = () => {
    syncContinuousScrollPageInput(side);
    ensureContinuousSlotsRendered(side);
  };
  session.continuousScrollHandler[side] = fn;
  getPane(side).canvasScroll.addEventListener("scroll", fn, { passive: true });
}

export function scrollContinuousToPage(side: PaneSide, pageNum: number): void {
  const slot = getPane(side).continuousStack.querySelector<HTMLElement>(
    `.continuous-page-slot[data-pdf-page="${pageNum}"]`
  );
  slot?.scrollIntoView({ block: "start", behavior: "smooth" });
}

function setupContinuousObserver(side: PaneSide): void {
  const p = getPane(side);
  const root = p.canvasScroll;
  session.continuousObservers.get(side)?.disconnect();
  const margin = Math.max(320, Math.round(root.clientHeight * 0.85));
  const io = new IntersectionObserver(
    (entries) => {
      for (const ent of entries) {
        if (!ent.isIntersecting) continue;
        void renderContinuousSlotContent(side, ent.target as HTMLElement);
      }
    },
    { root, rootMargin: `${margin}px 0px ${margin}px 0px`, threshold: 0 }
  );
  p.continuousStack.querySelectorAll(".continuous-page-slot").forEach((el) => io.observe(el));
  session.continuousObservers.set(side, io);
}

async function doRenderContinuousSlotContent(side: PaneSide, slot: HTMLElement): Promise<void> {
  const doc = session.paneState[side].doc;
  if (!doc) return;
  const pageNum = parseInt(slot.dataset.pdfPage ?? "1", 10);
  const revAtStart = session.continuousRev[side];
  if (slot.dataset.renderedRev === String(revAtStart)) return;

  const vpEl = slot.querySelector<HTMLElement>(".page-viewport");
  const canvas = slot.querySelector<HTMLCanvasElement>(".pdf-canvas");
  const textLayerEl = slot.querySelector<HTMLElement>(".text-layer");
  if (!vpEl || !canvas || !textLayerEl) return;

  const key = continuousLayerKey(side, pageNum);
  session.continuousTextLayers.get(key)?.cancel();
  session.continuousTextLayers.delete(key);

  const p = getPane(side);
  await waitLayout();
  if (session.continuousRev[side] !== revAtStart) return;

  const maxW = Math.max(100, p.canvasWrap.clientWidth - 16);
  const maxH = Math.max(100, p.canvasWrap.clientHeight - 16);
  const { page, viewport: vp } = await getScaledPageViewport(side, doc, pageNum, maxW, maxH);

  if (session.continuousRev[side] !== revAtStart) return;

  slot.style.minHeight = `${Math.ceil(vp.height) + 16}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);

  try {
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
  } catch (err) {
    console.error("Continuous page render failed", err);
    return;
  }

  if (session.continuousRev[side] !== revAtStart) return;

  textLayerEl.replaceChildren();
  try {
    const textContent = await page.getTextContent();
    bindTextLayerScale(textLayerEl, vp);
    const tl = new TextLayer({
      textContentSource: textContent,
      container: textLayerEl,
      viewport: vp,
    });
    session.continuousTextLayers.set(key, tl);
    await tl.render();
  } catch (err) {
    console.warn("Text layer failed (continuous)", err);
    session.continuousTextLayers.set(key, null);
  }

  if (session.continuousRev[side] !== revAtStart) return;

  try {
    await paintAnnotations(side, pageNum);
  } catch (err) {
    console.warn("Annotations paint failed (continuous)", err);
  }

  if (session.continuousRev[side] !== revAtStart) return;
  slot.dataset.renderedRev = String(session.continuousRev[side]);
}

/**
 * Renders every continuous page slot (viewport virtualization normally skips off-screen pages).
 * Used before print so all pages have canvas pixels.
 */
export async function renderAllContinuousSlotsForPrint(side: PaneSide): Promise<void> {
  if (session.paneScrollMode[side] !== "continuous") return;
  if (!session.paneState[side].doc) return;
  const slots = getPane(side).continuousStack.querySelectorAll<HTMLElement>(".continuous-page-slot");
  for (const slot of slots) {
    delete slot.dataset.renderedRev;
    await doRenderContinuousSlotContent(side, slot);
  }
}

function renderContinuousSlotContent(side: PaneSide, slot: HTMLElement): void {
  const doc = session.paneState[side].doc;
  if (!doc) return;
  const pageNum = parseInt(slot.dataset.pdfPage ?? "1", 10);
  const key = continuousLayerKey(side, pageNum);
  const prev = session.continuousSlotRenderTail.get(key) ?? Promise.resolve();
  const task = prev.then(() => doRenderContinuousSlotContent(side, slot));
  session.continuousSlotRenderTail.set(key, task.catch(() => {}));
  void task;
}

export async function renderContinuousDocument(side: PaneSide): Promise<void> {
  const doc = session.paneState[side].doc!;
  const p = getPane(side);
  p.singlePageShell.hidden = true;
  p.continuousStack.hidden = false;

  const maxW = Math.max(100, p.canvasWrap.clientWidth - 16);
  const maxH = Math.max(100, p.canvasWrap.clientHeight - 16);

  if (session.continuousBuiltRev[side] !== session.continuousRev[side]) {
    teardownContinuousUi(side);
    p.singlePageShell.hidden = true;
    p.continuousStack.hidden = false;
    const stack = p.continuousStack;
    for (let pn = 1; pn <= doc.numPages; pn++) {
      const slot = document.createElement("div");
      slot.className = "continuous-page-slot";
      slot.dataset.pdfPage = String(pn);
      const wrapV = document.createElement("div");
      wrapV.className = "page-viewport continuous-page-viewport";
      const c = document.createElement("canvas");
      c.className = "pdf-canvas";
      const hi = document.createElement("div");
      hi.className = "annotation-highlights";
      hi.setAttribute("aria-hidden", "true");
      const tl = document.createElement("div");
      tl.className = "text-layer";
      const no = document.createElement("div");
      no.className = "annotation-notes";
      wrapV.append(c, hi, tl, no);
      slot.append(wrapV);
      const { viewport } = await getScaledPageViewport(side, doc, pn, maxW, maxH);
      slot.style.minHeight = `${Math.ceil(viewport.height) + 16}px`;
      stack.append(slot);
    }
    session.continuousBuiltRev[side] = session.continuousRev[side];
    setupContinuousObserver(side);
    attachContinuousScrollSync(side);
    const startPage = Math.min(
      Math.max(1, parseInt(p.pageInput.value, 10) || 1),
      doc.numPages
    );
    requestAnimationFrame(() => {
      scrollContinuousToPage(side, startPage);
      requestAnimationFrame(() => {
        syncContinuousScrollPageInput(side);
        ensureContinuousSlotsRendered(side);
      });
    });
  }

  ensureContinuousSlotsRendered(side);

  updateNavDisabled();
  const wrap = p.canvasWrap;
  session.paneLayoutSnapshot.set(side, {
    w: Math.round(wrap.clientWidth),
    h: Math.round(wrap.clientHeight),
  });
  syncZoomUi(side);
}
