import { Capacitor } from "@capacitor/core";
import {
  buildAnnotationsExportPayload,
  downloadAnnotationsExport,
} from "../annotations-export";
import { isHighlightColorId } from "../highlight-colors";
import { CLOSE_LIBRARIES_EMBED_MESSAGE, OPEN_DOC_IN_READER_MESSAGE } from "../reader-bridge";
import * as storage from "../storage";
import { initShelvesUi } from "../shelves-ui";
import { setOpenNoteForEditHandler } from "./annotations-paint";
import {
  initChromeListeners,
  showToast,
  syncNoteModeButton,
  syncPaneDocLabel,
  updateAnnotationChrome,
  updateSelectionButtons,
} from "./chrome-toolbar";
import { copySelectionToClipboard } from "./copy-clipboard";
import {
  NARROW_MAX_PX,
  ZOOM_STEP,
  LAYOUT_STORAGE_KEY,
  PANE_MODE_STORAGE_KEY,
  SPLIT_RATIO_STORAGE_KEY,
  LAST_HIGHLIGHT_COLOR_KEY,
} from "./config";
import { bumpContinuousRev, bumpContinuousRevForOpenContinuousPanes } from "./continuous-helpers";
import { waitLayout } from "./dom";
import { openDocumentBuffer, wireFileInput } from "./file-open";
import {
  closeAllPaneFlyouts,
  closeLibrariesEmbed,
  openLibrariesEmbed,
  setAppMenuOpen,
  togglePaneToolsFlyout,
} from "./flyouts";
import {
  commitHighlightWithColor,
  closeHighlightColorPopover,
  openHighlightColorChooser,
  positionHighlightColorPopover,
  quickHighlightLastColor,
} from "./highlight-picker";
import {
  applyLayoutForViewport,
  getActivePaneTab,
  setActivePaneTab,
  syncPaneTabButtons,
} from "./layout-controller";
import { layoutRuntime, setLayoutMode, setPaneMode } from "./layout-bindings";
import { setAfterLayoutHandler, notifyAfterLayoutChange } from "./lifecycle";
import { refreshMarksDialog } from "./marks-dialog";
import { printPane } from "./print-pane";
import {
  deleteNoteFromDialog,
  openEditNoteDialog,
  openNoteAtSelection,
  submitNoteDialog,
  syncNoteDialogMode,
} from "./notes-dialog";
import { anyPaneHasDoc, bothPanesEmpty } from "./pane-queries";
import { wirePane } from "./pane-wire";
import {
  clearPaneForDeletedStorage,
  loadPdfBuffer,
  loadPdfBufferInitialBoth,
} from "./pdf-session";
import {
  PAGE_FRAME_ASPECT_KEY_PREFIX,
  loadPageFrameAspectsIntoSession,
  syncPageFrameSelect,
  writeStoredPageFrameAspect,
} from "./page-frame";
import { registerPdfRender, renderBothPanes, renderPane } from "./render-registry";
import { renderBothPanesImpl, renderPaneImpl } from "./pdf-render-pane";
import { initZoomListeners } from "./zoom-pane";
import { dismissSplashWhenReady } from "./splash";
import { checkForUpdate } from "./update-check";
import { activePaneForSelection, hideSelectionFloat } from "./selection-geometry";
import { updateSelectionFloatBar } from "./selection-float-bar";
import { getHighlightColorPopover, session } from "./session";
import type { PaneSide } from "./types";
import { adjustPaneZoom, setPaneBaseFit, syncZoomUi } from "./zoom-pane";
import { applySplitRatioToDom, initSplitDivider } from "./split-ratio";

function bufferFromDesktopPayload(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

function initDesktopLaunchOpen(): void {
  const shift = window.leapReaderDesktop?.shiftLaunchFile;
  if (!shift) return;

  const drainQueue = async (): Promise<void> => {
    let item = await shift();
    while (item) {
      try {
        await openDocumentBuffer(
          bufferFromDesktopPayload(item.buffer),
          item.name,
          item.lastModified,
          "left"
        );
      } catch (err) {
        console.error(err);
        alert(`Could not open ${item.name}.`);
      }
      item = await shift();
    }
  };

  void drainQueue();
  window.leapReaderDesktop?.onLaunchQueueChanged?.(() => void drainQueue());
}

/** Android: ACTION_VIEW opens a copy in cache; WebView loads it via Capacitor file URL bridge. */
function initAndroidLaunchOpen(): void {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;

  const handler = (ev: Event): void => {
    const d = ev as unknown as { fileUrl?: string; name?: string; lastModified?: number };
    const fileUrl = d.fileUrl;
    const name = d.name;
    if (!fileUrl || !name) return;
    const lastModified = typeof d.lastModified === "number" ? d.lastModified : Date.now();
    void (async () => {
      try {
        const src = Capacitor.convertFileSrc(fileUrl);
        const res = await fetch(src);
        if (!res.ok) throw new Error(String(res.status));
        const buf = await res.arrayBuffer();
        await openDocumentBuffer(buf, name, lastModified, "left");
      } catch (err) {
        console.error(err);
        alert(`Could not open ${name}.`);
      }
    })();
  };

  window.addEventListener("leapReaderAndroidFileOpen", handler);
}

export function bootstrapReader(): void {
  loadPageFrameAspectsIntoSession();

  // Register event-bus subscribers so chrome updates fire automatically
  // on every pane state change (Open/Closed: add new concerns here, not
  // in the state-mutation modules).
  initChromeListeners();
  initZoomListeners();

  registerPdfRender(renderPaneImpl, renderBothPanesImpl);
  setOpenNoteForEditHandler((id) => {
    void openEditNoteDialog(id);
  });

  wireFileInput("file-input-left", "left");
  wireFileInput("file-input-right", "right");

  const splashVersion = document.getElementById("splash-version");
  const aboutVersion = document.getElementById("about-version");
  if (splashVersion) splashVersion.textContent = `Version ${__APP_VERSION__}`;
  if (aboutVersion) aboutVersion.textContent = __APP_VERSION__;

  const appMenuBtn = document.getElementById("btn-app-menu") as HTMLButtonElement | null;
  const appMenuPanel = document.getElementById("app-menu-panel") as HTMLDivElement | null;
  const appMenuBackdrop = document.getElementById("app-menu-backdrop") as HTMLDivElement | null;

  appMenuBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = appMenuPanel ? !appMenuPanel.hidden : false;
    setAppMenuOpen(!isOpen);
  });

  appMenuBackdrop?.addEventListener("click", () => setAppMenuOpen(false));

  document.getElementById("btn-export-annotations")?.addEventListener("click", async () => {
    setAppMenuOpen(false);
    try {
      const payload = await buildAnnotationsExportPayload();
      if (payload.annotationCount === 0) {
        showToast("No highlights or notes to export yet");
        return;
      }
      downloadAnnotationsExport(payload);
      showToast(`Exported ${payload.annotationCount} mark${payload.annotationCount === 1 ? "" : "s"}`);
    } catch (err) {
      console.error(err);
      alert("Could not export highlights and notes.");
    }
  });

  document.getElementById("btn-help")?.addEventListener("click", () => {
    setAppMenuOpen(false);
    (document.getElementById("dialog-help") as HTMLDialogElement | null)?.showModal();
  });

  document.getElementById("btn-about")?.addEventListener("click", () => {
    setAppMenuOpen(false);
    (document.getElementById("dialog-about") as HTMLDialogElement | null)?.showModal();
  });

  document.getElementById("btn-reset-prefs")?.addEventListener("click", () => {
    setAppMenuOpen(false);
    (document.getElementById("dialog-reset-prefs") as HTMLDialogElement | null)?.showModal();
  });

  document.getElementById("btn-reset-prefs-yes")?.addEventListener("click", () => {
    localStorage.removeItem(PANE_MODE_STORAGE_KEY);
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
    localStorage.removeItem(SPLIT_RATIO_STORAGE_KEY);
    localStorage.removeItem(LAST_HIGHLIGHT_COLOR_KEY);
    localStorage.removeItem(`${PAGE_FRAME_ASPECT_KEY_PREFIX}left`);
    localStorage.removeItem(`${PAGE_FRAME_ASPECT_KEY_PREFIX}right`);
    location.reload();
  });

  for (const side of ["left", "right"] as const) {
    document.getElementById(`pane-tools-${side}`)?.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePaneToolsFlyout(side);
    });
    document.getElementById(`pane-flyout-backdrop-${side}`)?.addEventListener("click", () => {
      closeAllPaneFlyouts();
    });
  }

  for (const fid of ["file-input-left", "file-input-right"] as const) {
    document.getElementById(fid)?.addEventListener("change", () => {
      setAppMenuOpen(false);
      closeAllPaneFlyouts();
    });
  }

  const btnLibraries = document.getElementById("btn-libraries");
  btnLibraries?.addEventListener("click", () => {
    setAppMenuOpen(false);
    closeAllPaneFlyouts();
    openLibrariesEmbed();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (document.body.classList.contains("libraries-embed-active")) {
      e.preventDefault();
      closeLibrariesEmbed();
      return;
    }
    closeAllPaneFlyouts();
    setAppMenuOpen(false);
  });

  window.addEventListener("message", (ev: MessageEvent) => {
    if (ev.origin !== window.location.origin) return;
    const data = ev.data as { type?: string; docId?: string; pane?: string } | null;
    if (!data?.type) return;
    if (data.type === CLOSE_LIBRARIES_EMBED_MESSAGE) {
      closeLibrariesEmbed();
      return;
    }
    if (data.type !== OPEN_DOC_IN_READER_MESSAGE) return;
    const docId = data.docId;
    const pane = data.pane;
    if (!docId || (pane !== "left" && pane !== "right" && pane !== "auto")) return;
    void (async () => {
      const got = await storage.getDocumentData(docId);
      if (!got) {
        alert("This file is no longer in storage.");
        return;
      }
      await storage.touchDocumentOpened(docId);
      if (bothPanesEmpty()) {
        await loadPdfBufferInitialBoth(got.data, got.name, docId);
      } else if (pane === "auto") {
        const side: PaneSide = !session.paneState.left.doc
          ? "left"
          : !session.paneState.right.doc
            ? "right"
            : "left";
        await loadPdfBuffer(got.data, got.name, docId, side);
      } else {
        await loadPdfBuffer(got.data, got.name, docId, pane);
      }
      void storage.ensureDocumentInImportedLibrary(docId);
      // emitPaneDocChanged (fired inside loadPdf*) already updates the library button.
      await renderBothPanes();
    })();
  });

  initShelvesUi({
    closeChromeFlyouts: () => {
      setAppMenuOpen(false);
      closeAllPaneFlyouts();
    },
    loadPdfFromBytes: loadPdfBuffer,
    loadPdfIntoBothPanes: loadPdfBufferInitialBoth,
    areBothPanesEmpty: bothPanesEmpty,
    getStorageIdForPane: (pane) => session.paneState[pane].storageId,
    clearPaneForDeletedStorage,
  });

  for (const side of ["left", "right"] as const) {
    wirePane(side);
  }

  for (const side of ["left", "right"] as const) {
    syncPaneDocLabel(side);
    syncZoomUi(side);
  }

  for (const side of ["left", "right"] as const) {
    // Restore persisted line-numbers preference.
    const lnKey = `lineNumbers-${side}`;
    const lnBtn = document.getElementById(`btn-line-numbers-${side}`) as HTMLButtonElement | null;
    const docViewEl = document.querySelector<HTMLElement>(`.pane[data-side="${side}"] .doc-view`);
    const applyLineNumbers = (on: boolean) => {
      if (lnBtn) lnBtn.setAttribute("aria-pressed", String(on));
      if (docViewEl) docViewEl.classList.toggle("doc-view--line-numbers", on);
    };
    applyLineNumbers(localStorage.getItem(lnKey) === "true");
    lnBtn?.addEventListener("click", () => {
      const next = lnBtn.getAttribute("aria-pressed") !== "true";
      applyLineNumbers(next);
      localStorage.setItem(lnKey, String(next));
    });
  }

  for (const side of ["left", "right"] as const) {
    document.getElementById(`btn-copy-${side}`)?.addEventListener("click", () => {
      void copySelectionToClipboard();
    });
    document.getElementById(`btn-highlight-${side}`)?.addEventListener("click", (e) => {
      if (e.shiftKey) {
        void quickHighlightLastColor(side);
        return;
      }
      openHighlightColorChooser(side, null);
    });
    document.getElementById(`btn-zoom-in-${side}`)?.addEventListener("click", () => {
      adjustPaneZoom(side, ZOOM_STEP);
    });
    document.getElementById(`btn-zoom-out-${side}`)?.addEventListener("click", () => {
      adjustPaneZoom(side, 1 / ZOOM_STEP);
    });
    document.getElementById(`btn-zoom-fit-${side}`)?.addEventListener("click", () => {
      setPaneBaseFit(side, "page");
    });
    document.getElementById(`btn-zoom-width-${side}`)?.addEventListener("click", () => {
      setPaneBaseFit(side, "width");
    });
    document.getElementById(`btn-note-${side}`)?.addEventListener("click", () => {
      if (!session.paneState[side].doc) return;
      session.noteMode = !session.noteMode;
      syncNoteModeButton();
      window.getSelection()?.removeAllRanges();
      hideSelectionFloat();
      updateSelectionButtons();
    });
    document.getElementById(`btn-marks-${side}`)?.addEventListener("click", () => {
      closeAllPaneFlyouts();
      const d = document.getElementById("dialog-marks") as HTMLDialogElement;
      void refreshMarksDialog().then(() => d.showModal());
    });
    document.getElementById(`btn-print-${side}-with-hl`)?.addEventListener("click", () => {
      printPane(side, true);
    });
    document.getElementById(`btn-print-${side}-without-hl`)?.addEventListener("click", () => {
      printPane(side, false);
    });
  }

  for (const side of ["left", "right"] as const) {
    syncPageFrameSelect(side);
    const sel = document.getElementById(`page-frame-${side}`) as HTMLSelectElement | null;
    sel?.addEventListener("change", () => {
      const v = sel.value;
      const aspect = v === "" ? null : parseFloat(v);
      session.panePageFrameAspect[side] =
        aspect != null && Number.isFinite(aspect) && aspect > 0 ? aspect : null;
      writeStoredPageFrameAspect(side, session.panePageFrameAspect[side]);
      session.paneLayoutSnapshot.delete(side);
      if (session.paneScrollMode[side] === "continuous") bumpContinuousRev(side);
      void renderPane(side);
      syncZoomUi(side);
    });
  }

  const dialogAddNoteEl = document.getElementById("dialog-add-note") as HTMLDialogElement | null;
  dialogAddNoteEl?.addEventListener("close", () => {
    session.pendingNotePlacement = null;
    session.noteDialogEditingId = null;
    session.noteDialogEditContext = null;
    syncNoteDialogMode("add");
  });
  document.getElementById("dialog-note-save")?.addEventListener("click", () => {
    void submitNoteDialog();
  });
  document.getElementById("dialog-note-delete")?.addEventListener("click", () => {
    void deleteNoteFromDialog();
  });
  document.getElementById("dialog-note-cancel")?.addEventListener("click", () => {
    dialogAddNoteEl?.close();
  });
  dialogAddNoteEl?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !e.ctrlKey) return;
    const t = e.target as HTMLElement;
    if (t.id !== "dialog-note-text") return;
    e.preventDefault();
    void submitNoteDialog();
  });

  document.addEventListener("selectionchange", () => {
    updateSelectionButtons();
    if (session.selectionFloatRaf != null) cancelAnimationFrame(session.selectionFloatRaf);
    session.selectionFloatRaf = requestAnimationFrame(() => {
      session.selectionFloatRaf = null;
      updateSelectionFloatBar();
    });
  });

  document.getElementById("selection-float")?.addEventListener("mousedown", (e) => {
    e.preventDefault();
  });

  document.getElementById("selection-float-copy")?.addEventListener("click", () => {
    void copySelectionToClipboard();
    hideSelectionFloat();
  });

  document.getElementById("selection-float-highlight")?.addEventListener("click", (e) => {
    const side = session.lastSelectionFloatSide;
    if (!side) return;
    if (e.shiftKey) {
      void quickHighlightLastColor(side);
      hideSelectionFloat();
      return;
    }
    const bar = document.getElementById("selection-float");
    openHighlightColorChooser(side, bar);
  });

  document.getElementById("selection-float-note")?.addEventListener("click", () => {
    const side = session.lastSelectionFloatSide;
    if (!side) return;
    openNoteAtSelection(side);
  });

  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return;
    const t = e.target as HTMLElement | null;
    if (!t) return;
    if (t.closest("dialog[open]")) return;
    if (t.matches("input, textarea, select, [contenteditable]")) return;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || !e.shiftKey) return;
    const key = e.key.toLowerCase();
    if (key !== "h" && key !== "n") return;
    if (session.noteMode) return;
    const side = activePaneForSelection();
    if (!side || !session.paneState[side].doc) return;
    e.preventDefault();
    if (key === "h") void quickHighlightLastColor(side);
    else openNoteAtSelection(side);
  });

  getHighlightColorPopover()?.querySelectorAll<HTMLButtonElement>(".highlight-swatch").forEach((btn: HTMLButtonElement) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.hlColor;
      if (id && isHighlightColorId(id)) void commitHighlightWithColor(id);
    });
  });
  document.getElementById("highlight-color-cancel")?.addEventListener("click", () => {
    closeHighlightColorPopover();
  });

  document.addEventListener(
    "mousedown",
    (e) => {
      if (getHighlightColorPopover()?.hidden) return;
      const el = e.target as HTMLElement | null;
      if (!el) return;
      if (getHighlightColorPopover()?.contains(el)) return;
      if (el.closest('[id^="btn-highlight-"]')) return;
      if (el.closest("#selection-float")) return;
      if (el.closest(".pane-flyout")) return;
      if (el.closest(".pane-tools-fab")) return;
      closeHighlightColorPopover();
    },
    true
  );

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (getHighlightColorPopover()?.hidden) return;
    e.preventDefault();
    closeHighlightColorPopover();
  });

  document.querySelectorAll<HTMLButtonElement>(".btn-seg[data-layout]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.layout as "split" | "tabs";
      setLayoutMode(mode);
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".btn-seg[data-pane-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.paneMode as "single" | "split";
      setPaneMode(mode);
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".btn-tab[data-pane-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const side = btn.dataset.paneTab as PaneSide;
      setActivePaneTab(side);
      notifyAfterLayoutChange();
    });
  });

  setAfterLayoutHandler(() => {
    if (anyPaneHasDoc()) void renderBothPanes();
  });

  applyLayoutForViewport();
  syncPaneTabButtons(getActivePaneTab());
  updateAnnotationChrome();
  window.matchMedia(`(max-width: ${NARROW_MAX_PX}px)`).addEventListener("change", () => {
    applyLayoutForViewport();
    if (anyPaneHasDoc()) {
      session.paneLayoutSnapshot.clear();
      bumpContinuousRevForOpenContinuousPanes();
    }
    void waitLayout().then(() => notifyAfterLayoutChange());
  });

  window.addEventListener("resize", () => {
    if (!getHighlightColorPopover()?.hidden && session.highlightPopoverAnchorEl) {
      positionHighlightColorPopover(session.highlightPopoverAnchorEl);
    }
    updateSelectionFloatBar();
    if (!anyPaneHasDoc()) return;
    void renderBothPanes();
  });

  applySplitRatioToDom();
  initSplitDivider(() => {
    layoutRuntime().invalidatePaneMeasures();
    void waitLayout().then(() => notifyAfterLayoutChange());
  });

  initDesktopLaunchOpen();
  initAndroidLaunchOpen();

  dismissSplashWhenReady();

  // Check for updates in the background after startup settles.
  window.setTimeout(() => {
    void checkForUpdate(({ version, url, isUpToDate, error }) => {
      const latestRow = document.getElementById("about-latest-row") as HTMLElement | null;
      const latestLink = document.getElementById("about-latest-version") as HTMLAnchorElement | null;
      const updateStatus = document.getElementById("about-update-status");
      if (!latestRow || !latestLink || !updateStatus) return;

      if (error) {
        latestLink.textContent = "check failed";
        latestLink.href = url;
        latestLink.title = url;
        updateStatus.textContent = `(${error})`;
        updateStatus.className = "about-update-status";
        latestRow.hidden = false;
        return;
      }

      if (!version) return;

      latestLink.textContent = version;
      latestLink.href = url;
      if (isUpToDate) {
        updateStatus.textContent = "✓ up to date";
        updateStatus.className = "about-update-status about-update-status--ok";
      } else {
        updateStatus.textContent = "↑ update available";
        updateStatus.className = "about-update-status about-update-status--new";
      }
      latestRow.hidden = false;

      // Toast only when an update is available and About dialog is not open.
      if (!isUpToDate) {
        const aboutDialog = document.getElementById("dialog-about") as HTMLDialogElement | null;
        if (!aboutDialog?.open) {
          showToast(`Update available: ${version}`, 6000);
        }
      }
    });
  }, 3000);
}
