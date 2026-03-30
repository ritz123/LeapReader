import { showToast } from "./chrome-toolbar";
import { closeAllPaneFlyouts, setAppMenuOpen } from "./flyouts";
import { preparePaneForPrint } from "./pdf-render-pane";
import { session } from "./session";
import type { PaneSide } from "./types";

let restorePrintPrepLayout: (() => void) | null = null;

function ensurePaneMeasurableForPrintPrep(side: PaneSide): void {
  restorePrintPrepLayout?.();
  restorePrintPrepLayout = null;
  const pane = document.querySelector<HTMLElement>(`#split .pane[data-side="${side}"]`);
  if (!pane) return;
  if (getComputedStyle(pane).display !== "none") return;
  const saved = pane.style.cssText;
  pane.style.setProperty("display", "flex", "important");
  pane.style.position = "fixed";
  pane.style.left = "-12000px";
  pane.style.top = "0";
  pane.style.width = "100vw";
  pane.style.height = "100vh";
  pane.style.overflow = "hidden";
  pane.style.boxSizing = "border-box";
  restorePrintPrepLayout = () => {
    pane.style.cssText = saved;
  };
}

function clearPrintPrepLayout(): void {
  restorePrintPrepLayout?.();
  restorePrintPrepLayout = null;
}

/**
 * Opens the system print dialog for one pane. Uses @media print rules on
 * `body[data-print-pane]` / `body[data-print-highlights]`.
 * Prerenders all pages first (continuous mode normally only paints the viewport).
 */
export async function printPane(side: PaneSide, includeHighlights: boolean): Promise<void> {
  if (!session.paneState[side].doc) {
    showToast("Open a PDF document in this pane to print");
    return;
  }

  closeAllPaneFlyouts();
  setAppMenuOpen(false);

  const doc = session.paneState[side].doc!;
  const n = doc.numPages;
  if (n > 8) {
    showToast(`Preparing ${n} pages for print…`, 12000);
  }

  ensurePaneMeasurableForPrintPrep(side);

  try {
    await preparePaneForPrint(side);
  } catch (err) {
    console.error("Print preparation failed", err);
    showToast("Could not prepare this document for print");
    clearPrintPrepLayout();
    return;
  }

  document.body.dataset.printPane = side;
  document.body.dataset.printHighlights = includeHighlights ? "1" : "0";

  const cleanup = (): void => {
    delete document.body.dataset.printPane;
    delete document.body.dataset.printHighlights;
    clearPrintPrepLayout();
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup, { passive: true });

  requestAnimationFrame(() => {
    window.print();
  });
}
