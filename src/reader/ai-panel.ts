/**
 * AI Panel — Story 2.1
 *
 * Manages the per-pane AI chat panel shell:
 * - Toggle button wiring (AI FAB)
 * - Panel open/close state with canvas-wrap class (UX-R2)
 * - Backend status display (backend:ready / backend:down / backend:failed)
 * - localStorage persistence of panel open state
 */

import type { PaneSide } from "./types";
import { initAiInputRow } from "./ai-input";
import { onPaneDocChanged } from "./ai-context";
import { onPaneDocChanged as onDocEvent } from "./pane-events";
import { session } from "./session";
import { clearMessages } from "./ai-chat";
import { runReview } from "./ai-review";
import { showToast } from "./chrome-toolbar";
import { initModelBrowser, refreshModelBadge } from "./ai-model-browser";
import { getActiveModel, getOllamaUrl, DEFAULT_OLLAMA_URL } from "./ai-constants";

const _cachedContext: Partial<Record<PaneSide, string>> = {};

/** Pre-warm context cache for a pane (call whenever doc changes or panel opens). */
export async function warmContextCache(side: PaneSide): Promise<void> {
  try {
    const { extractPaneContextText } = await import("./ai-context");
    _cachedContext[side] = await extractPaneContextText(side);
  } catch {
    _cachedContext[side] = "";
  }
}

const STORAGE_KEYS: Record<PaneSide, string> = {
  left: "leapReaderAIPanelLeft",
  right: "leapReaderAIPanelRight",
};

const POPOUT_POS_KEYS: Record<PaneSide, string> = {
  left: "leapReaderAIPanelLeftPos",
  right: "leapReaderAIPanelRightPos",
};

const DEFAULT_POPOUT_POS: Record<PaneSide, { l: number; t: number }> = {
  left: { l: 40, t: 60 },
  right: { l: 100, t: 80 },
};

const _originalParents: Partial<Record<PaneSide, HTMLElement>> = {};
const _poppedState: Partial<Record<PaneSide, boolean>> = {};
const _dragCleanups: Partial<Record<PaneSide, () => void>> = {};
const _escapeHandlers: Partial<Record<PaneSide, (e: KeyboardEvent) => void>> = {};

let _backendPort: number | null = null;

function getPanelEl(side: PaneSide): HTMLElement | null {
  return document.getElementById(`ai-chat-panel-${side}`);
}

function getFabEl(side: PaneSide): HTMLElement | null {
  return document.getElementById(`pane-ai-${side}`);
}

function getCanvasWrap(side: PaneSide): HTMLElement | null {
  return document
    .querySelector(`.pane[data-side="${side}"] .canvas-wrap`) as HTMLElement | null;
}

function getStatusEl(side: PaneSide): HTMLElement | null {
  return document.getElementById(`ai-chat-status-${side}`);
}

function getDocBadgeEl(side: PaneSide): HTMLElement | null {
  return document.getElementById(`ai-doc-badge-${side}`);
}

function getModelBadgeEl(side: PaneSide): HTMLElement | null {
  return document.getElementById(`ai-model-badge-${side}`);
}

function getPopoutBtn(side: PaneSide): HTMLElement | null {
  return document.getElementById(`ai-chat-popout-${side}`);
}

export function isAiPanelPopped(side: PaneSide): boolean {
  return _poppedState[side] === true;
}

function _savedPopoutPos(side: PaneSide): { l: number; t: number } {
  try {
    const raw = localStorage.getItem(POPOUT_POS_KEYS[side]);
    if (raw) {
      const pos = JSON.parse(raw) as { l: number; t: number };
      return {
        l: Math.max(0, Math.min(pos.l, window.innerWidth - 200)),
        t: Math.max(0, Math.min(pos.t, window.innerHeight - 40)),
      };
    }
  } catch { /* ignore */ }
  return DEFAULT_POPOUT_POS[side];
}

function _persistPopoutPos(side: PaneSide, l: number, t: number): void {
  try {
    localStorage.setItem(POPOUT_POS_KEYS[side], JSON.stringify({ l, t }));
  } catch { /* ignore */ }
}

function _wireDrag(side: PaneSide, panel: HTMLElement): void {
  const header = panel.querySelector<HTMLElement>(".ai-chat-header");
  if (!header) return;

  const onMouseDown = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, input, select, textarea")) return;
    e.preventDefault();
    const rect = panel.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    const onMouseMove = (ev: MouseEvent) => {
      const newLeft = Math.max(0, Math.min(ev.clientX - offsetX, window.innerWidth - 100));
      const newTop = Math.max(0, Math.min(ev.clientY - offsetY, window.innerHeight - 40));
      panel.style.left = `${newLeft}px`;
      panel.style.top = `${newTop}px`;
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      _persistPopoutPos(side, parseInt(panel.style.left, 10) || 0, parseInt(panel.style.top, 10) || 0);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  header.addEventListener("mousedown", onMouseDown);
  _dragCleanups[side] = () => header.removeEventListener("mousedown", onMouseDown);
}

function _unwireDrag(side: PaneSide): void {
  _dragCleanups[side]?.();
  delete _dragCleanups[side];
}

/** Pop the AI chat panel out as a floating overlay, or re-dock it. */
export function setAiPanelPopped(side: PaneSide, popped: boolean): void {
  const panel = getPanelEl(side);
  const wrap = getCanvasWrap(side);
  const popoutBtn = getPopoutBtn(side);
  if (!panel || !wrap) return;

  if (popped) {
    _originalParents[side] = panel.parentElement as HTMLElement;
    const pos = _savedPopoutPos(side);

    document.body.appendChild(panel);
    panel.classList.add("ai-chat-panel--popped");
    panel.style.left = `${pos.l}px`;
    panel.style.top = `${pos.t}px`;

    wrap.classList.remove("ai-panel-open");

    popoutBtn?.setAttribute("aria-pressed", "true");
    popoutBtn?.setAttribute("title", "Re-dock chat");
    popoutBtn?.setAttribute("aria-label", "Re-dock AI chat");

    _poppedState[side] = true;

    const escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setAiPanelPopped(side, false);
      }
    };
    _escapeHandlers[side] = escHandler;
    panel.addEventListener("keydown", escHandler);

    _wireDrag(side, panel);
  } else {
    // Re-dock: move panel back before the flyout backdrop
    const originalParent = _originalParents[side] ?? wrap;
    const backdrop = document.getElementById(`pane-flyout-backdrop-${side}`);
    if (backdrop && originalParent.contains(backdrop)) {
      originalParent.insertBefore(panel, backdrop);
    } else {
      originalParent.appendChild(panel);
    }

    panel.classList.remove("ai-chat-panel--popped");
    panel.style.left = "";
    panel.style.top = "";
    panel.style.width = "";
    panel.style.height = "";

    if (!panel.hidden) {
      wrap.classList.add("ai-panel-open");
    }

    popoutBtn?.setAttribute("aria-pressed", "false");
    popoutBtn?.setAttribute("title", "Pop out chat");
    popoutBtn?.setAttribute("aria-label", "Pop out AI chat");

    _poppedState[side] = false;

    const escHandler = _escapeHandlers[side];
    if (escHandler) {
      panel.removeEventListener("keydown", escHandler);
      delete _escapeHandlers[side];
    }
    _unwireDrag(side);
    delete _originalParents[side];
  }
}

export function setAiPanelOpen(side: PaneSide, open: boolean): void {
  const panel = getPanelEl(side);
  const fab = getFabEl(side);
  const wrap = getCanvasWrap(side);
  if (!panel || !fab || !wrap) return;

  if (open) {
    panel.removeAttribute("hidden");
    fab.setAttribute("aria-pressed", "true");
    // Only set canvas-wrap class when panel is docked (not floating)
    if (!isAiPanelPopped(side)) {
      wrap.classList.add("ai-panel-open");
    }
  } else {
    panel.setAttribute("hidden", "");
    fab.setAttribute("aria-pressed", "false");
    wrap.classList.remove("ai-panel-open");
  }

  try {
    localStorage.setItem(STORAGE_KEYS[side], open ? "1" : "0");
  } catch {
    /* ignore quota errors */
  }
}

export function isAiPanelOpen(side: PaneSide): boolean {
  return !getPanelEl(side)?.hidden;
}

function setStatus(side: PaneSide, message: string): void {
  const el = getStatusEl(side);
  if (el) el.textContent = message;
}

function updateModelBadge(): void {
  const model = getActiveModel();
  for (const side of ["left", "right"] as PaneSide[]) {
    const el = getModelBadgeEl(side);
    if (el) el.textContent = model;
  }
}

/** Update the doc name badge for a pane (called by chrome-toolbar on doc change). */
export function setAiDocName(side: PaneSide, name: string | null): void {
  const el = getDocBadgeEl(side);
  if (el) el.textContent = name ?? "No document";
}

/** Wire AI FAB and close buttons. Call after DOM ready. */
export function initAiPanel(): void {
  for (const side of ["left", "right"] as PaneSide[]) {
    const fab = getFabEl(side);
    const closeBtn = document.getElementById(`ai-chat-close-${side}`);

    fab?.addEventListener("click", () => {
      const opening = !isAiPanelOpen(side);
      setAiPanelOpen(side, opening);
      if (opening) void warmContextCache(side);
    });

    closeBtn?.addEventListener("click", () => {
      if (isAiPanelPopped(side)) {
        setAiPanelPopped(side, false);
      }
      setAiPanelOpen(side, false);
    });

    // Pop-out button — float/re-dock the panel
    const popoutBtn = getPopoutBtn(side);
    popoutBtn?.addEventListener("click", () => {
      const willPop = !isAiPanelPopped(side);
      if (willPop && !isAiPanelOpen(side)) {
        // Open the panel first so it becomes visible when floating
        setAiPanelOpen(side, true);
      }
      setAiPanelPopped(side, willPop);
    });

    // Clear button — Story 2.5
    const clearBtn = document.getElementById(`ai-clear-btn-${side}`);
    clearBtn?.addEventListener("click", () => {
      clearMessages(side);
      showToast("Chat cleared");
    });

    // Summarize button — Story 3.1
    const summarizeBtn = document.getElementById(`btn-summarize-${side}`) as HTMLButtonElement | null;
    summarizeBtn?.addEventListener("click", () => {
      void runSummarize(side);
    });

    // Review buttons — Stories 3.3 + 3.4
    document.getElementById(`btn-review-${side}`)?.addEventListener("click", () => void runReview(side, false));
    document.getElementById(`btn-review-offline-${side}`)?.addEventListener("click", () => void runReview(side, true));

    // Model browser — Story 4.3
    initModelBrowser(side);

    // Restore persisted panel state
    try {
      if (localStorage.getItem(STORAGE_KEYS[side]) === "1") {
        setAiPanelOpen(side, true);
      }
    } catch {
      /* ignore */
    }

    setStatus(side, "Connecting to AI…");
  }

  updateModelBadge();

  // Subscribe to document changes → update AI panel badge + warm context cache + enable buttons
  onDocEvent((side) => {
    onPaneDocChanged(side);
    void warmContextCache(side);
    const summarizeBtn = document.getElementById(`btn-summarize-${side}`) as HTMLButtonElement | null;
    if (summarizeBtn) summarizeBtn.disabled = !session.paneState[side].doc;
    const reviewBtn = document.getElementById(`btn-review-${side}`) as HTMLButtonElement | null;
    const reviewOfflineBtn = document.getElementById(`btn-review-offline-${side}`) as HTMLButtonElement | null;
    if (reviewBtn) reviewBtn.disabled = !session.paneState[side].doc;
    if (reviewOfflineBtn) reviewOfflineBtn.disabled = !session.paneState[side].doc;
  });

  // Wire input rows for each pane with real context extraction (AD-7)
  for (const side of ["left", "right"] as PaneSide[]) {
    initAiInputRow(side, () => {
      // extractPaneContextText is async; return cached last extraction or ""
      // The input.ts submitChat calls this synchronously, so we pre-cache below
      return _cachedContext[side] ?? "";
    });
  }

  // "Ask AI" from selection float bar — Story 2.6 (AD-10)
  const askAiBtn = document.getElementById("selection-float-ask-ai");
  askAiBtn?.addEventListener("click", () => {
    const floatEl = document.getElementById("selection-float") as HTMLElement | null;
    const side = (floatEl?.dataset.paneId ?? "left") as PaneSide;
    const sel = window.getSelection();
    const selectedText = sel?.toString().trim() ?? "";
    if (!selectedText) return;

    // Open panel and pre-fill input
    setAiPanelOpen(side, true);

    const inputEl = document.getElementById(`ai-input-${side}`) as HTMLTextAreaElement | null;
    if (inputEl) {
      inputEl.value = `Explain: ${selectedText}`;
      inputEl.dispatchEvent(new Event("input"));
      // Focus the input so the user can review/edit and press Enter to submit.
      // Do NOT auto-submit — the user must confirm (Decision-1 resolved).
      requestAnimationFrame(() => inputEl.focus());
    }

    // Hide the float bar (but keep selection so user can see what they chose)
    sel?.removeAllRanges();
  });

  // Wire backend lifecycle events if available
  const ai = (window as unknown as Record<string, unknown>).leapReaderAI as Record<string, Function> | undefined;
  if (!ai) return;

  ai.onBackendReady?.((data: { port: number }) => {
    _backendPort = data.port;
    for (const side of ["left", "right"] as PaneSide[]) {
      setStatus(side, "");
      refreshModelBadge(side);
    }
    // If the user previously configured a custom Ollama URL, push it to the
    // backend now so all subsequent requests go to the right server.
    const storedUrl = getOllamaUrl();
    if (storedUrl && storedUrl !== DEFAULT_OLLAMA_URL) {
      void fetch(`http://127.0.0.1:${data.port}/config/ollama`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: storedUrl }),
      }).catch(() => { /* non-critical — backend will use its default */ });
    }
  });

  // If backend:ready already fired before this listener was registered (race
  // condition: backend starts before renderer JS finishes loading), query the
  // current port directly from the main process and seed _backendPort now.
  void (ai.getBackendPort?.() as Promise<number | null> | undefined)?.then((port) => {
    if (port && !_backendPort) {
      _backendPort = port;
      for (const side of ["left", "right"] as PaneSide[]) {
        setStatus(side, "");
        refreshModelBadge(side);
      }
      const storedUrl = getOllamaUrl();
      if (storedUrl && storedUrl !== DEFAULT_OLLAMA_URL) {
        void fetch(`http://127.0.0.1:${port}/config/ollama`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: storedUrl }),
        }).catch(() => {});
      }
    }
  });

  ai.onBackendDown?.((data: { attempt: number; maxAttempts: number }) => {
    _backendPort = null;  // Prevent stale port usage during restart window (EC-08)
    for (const side of ["left", "right"] as PaneSide[]) {
      setStatus(side, `AI restarting… (${data.attempt}/${data.maxAttempts})`);
    }
  });

  ai.onBackendFailed?.(() => {
    _backendPort = null;
    for (const side of ["left", "right"] as PaneSide[]) {
      setStatus(side, "AI unavailable");
    }
  });

  ai.onPullProgress?.((event: { type: string; pane_id: string; payload: { model: string; percent: number; status: string } }) => {
    const { pane_id, payload } = event;
    const targetSides = (pane_id === "left" || pane_id === "right")
      ? [pane_id as PaneSide]
      : (["left", "right"] as PaneSide[]);
    for (const side of targetSides) {
      const statusEl = getStatusEl(side);
      if (!statusEl) continue;

      if (payload.status === "already_present" || payload.percent >= 100) {
        setStatus(side, "");
        statusEl.parentElement?.querySelector(".ai-startup-pull-bar-wrap")?.remove();
        updateModelBadge();
        continue;
      }

      const pct = payload.percent;
      setStatus(side, pct > 0
        ? `Downloading ${payload.model}… ${pct}%`
        : `Downloading ${payload.model}…`);

      // Create bar on first progress event, update on subsequent ones
      let barWrap = statusEl.parentElement?.querySelector<HTMLElement>(".ai-startup-pull-bar-wrap") ?? null;
      if (!barWrap) {
        barWrap = document.createElement("div");
        barWrap.className = "ai-startup-pull-bar-wrap";
        const bar = document.createElement("div");
        bar.className = "ai-startup-pull-bar indeterminate";
        barWrap.appendChild(bar);
        statusEl.insertAdjacentElement("afterend", barWrap);
      }
      if (pct > 0) {
        const bar = barWrap.querySelector<HTMLElement>(".ai-startup-pull-bar");
        if (bar) {
          bar.classList.remove("indeterminate");
          bar.style.width = `${pct}%`;
        }
      }
    }
  });
}

/** Return the backend port if ready, or null. */
export function getBackendPort(): number | null {
  return _backendPort;
}

/** Run a summarize request for a pane (Story 3.1). */
async function runSummarize(side: PaneSide): Promise<void> {
  const port = _backendPort;
  if (!port) {
    showToast("AI is not ready yet");
    return;
  }

  // Open panel and warm context
  setAiPanelOpen(side, true);
  await warmContextCache(side);
  const contextText = _cachedContext[side] ?? "";

  if (!contextText) {
    showToast("No document content to summarize");
    return;
  }

  // Show a user "shortcut" message
  const { appendUserMessage } = await import("./ai-chat");
  appendUserMessage(side, "Summarize this document");

  const { startAssistantMessage, setContextTruncatedWarning } = await import("./ai-chat");
  const { appendToken, finalize, setError } = startAssistantMessage(side);

  const sessionId = crypto.randomUUID();
  const url = `http://127.0.0.1:${port}/summarize/${side}/${sessionId}`;
  const body = JSON.stringify({
    pane_id: side,
    session_id: sessionId,
    context_text: contextText,
    model: getActiveModel(),
  });

  // Wire Stop button for summarize streams (EC-06)
  const abortController = new AbortController();
  const ai = (window as unknown as Record<string, unknown>).leapReaderAI as Record<string, Function> | undefined;
  const stopBtn = document.getElementById(`ai-stop-${side}`) as HTMLButtonElement | null;
  const sendBtn = document.getElementById(`ai-send-${side}`) as HTMLButtonElement | null;
  if (stopBtn) stopBtn.removeAttribute("hidden");
  if (sendBtn) sendBtn.disabled = true;
  const onStop = () => {
    abortController.abort();
    void ai?.abortStream?.(side, sessionId, "summarize");
  };
  stopBtn?.addEventListener("click", onStop, { once: true });

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: abortController.signal,
    });
    if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw) continue;
        try {
          const evt = JSON.parse(raw) as { type: string; pane_id: string; payload: Record<string, unknown> };
          if (evt.pane_id !== side) continue;
          if (evt.type === "token") appendToken(String(evt.payload.text ?? ""));
          else if (evt.type === "meta" && evt.payload.context_truncated) setContextTruncatedWarning(side, true);
          else if (evt.type === "error") setError(String(evt.payload.message || "Summarize error"));
        } catch { /* skip */ }
      }
    }
    finalize("");
  } catch (err: unknown) {
    if ((err as Error)?.name === "AbortError") {
      finalize("");
    } else {
      setError((err as Error)?.message ?? "Summarize failed", () => void runSummarize(side));
    }
  } finally {
    stopBtn?.removeEventListener("click", onStop);
    if (stopBtn) stopBtn.setAttribute("hidden", "");
    if (sendBtn) {
      const textarea = document.getElementById(`ai-input-${side}`) as HTMLTextAreaElement | null;
      sendBtn.disabled = textarea?.value.trim() === "";
    }
  }
}
