/**
 * AI Chat — Story 2.2
 *
 * Message thread rendering and SSE token stream display for each pane.
 *
 * Public API:
 *   appendUserMessage(side, text)
 *   startAssistantMessage(side) → { appendToken, finalize, setError }
 *   clearMessages(side)
 *   getMessages(side) → ChatMessage[]
 *   setContextTruncatedWarning(side, visible)
 */

import type { PaneSide } from "./types";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
}

// Per-pane message history
const _history: Record<PaneSide, ChatMessage[]> = { left: [], right: [] };

const ICON_COPY =
  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
  `<rect x="9" y="9" width="13" height="13" rx="2"/>` +
  `<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

const ICON_CHECK =
  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
  `<polyline points="20 6 9 17 4 12"/></svg>`;

/** Build a copy-to-clipboard button that pulls its text from a getter. */
function makeCopyBtn(getText: () => string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ai-copy-btn";
  btn.setAttribute("aria-label", "Copy message");
  btn.innerHTML = ICON_COPY;

  btn.addEventListener("click", async () => {
    const text = getText();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;left:-9999px;top:-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    btn.innerHTML = ICON_CHECK;
    btn.classList.add("ai-copy-btn--copied");
    setTimeout(() => {
      btn.innerHTML = ICON_COPY;
      btn.classList.remove("ai-copy-btn--copied");
    }, 1500);
  });

  return btn;
}

function getMessagesEl(side: PaneSide): HTMLElement | null {
  return document.getElementById(`ai-chat-messages-${side}`);
}

function scrollToBottom(el: HTMLElement): void {
  requestAnimationFrame(() => {
    el.scrollTop = el.scrollHeight;
  });
}

/** Append a user message bubble. */
export function appendUserMessage(side: PaneSide, text: string): void {
  const container = getMessagesEl(side);
  if (!container) return;

  const msg: ChatMessage = { role: "user", content: text };
  _history[side].push(msg);

  const bubble = document.createElement("div");
  bubble.className = "ai-msg ai-msg--user";
  bubble.textContent = text;
  container.appendChild(bubble);
  scrollToBottom(container);
}

/** Begin an assistant message. Returns handles to append tokens and finalize. */
export function startAssistantMessage(side: PaneSide): {
  appendToken: (text: string) => void;
  finalize: (finalContent: string) => void;
  setError: (message: string, onRetry?: () => void) => void;
} {
  const container = getMessagesEl(side);

  const bubble = document.createElement("div");
  bubble.className = "ai-msg ai-msg--assistant ai-msg--streaming";
  const content = document.createElement("span");
  content.className = "ai-msg-content";
  bubble.appendChild(content);

  const cursor = document.createElement("span");
  cursor.className = "ai-msg-cursor";
  cursor.setAttribute("aria-hidden", "true");
  bubble.appendChild(cursor);

  container?.appendChild(bubble);

  let accumulated = "";

  const msg: ChatMessage = { role: "assistant", content: "" };
  // Capture the index so concurrent streams don't step on each other when
  // setError removes its own entry (EC-10 — no more pop()).
  const msgIndex = _history[side].push(msg) - 1;

  function appendToken(text: string): void {
    accumulated += text;
    msg.content = accumulated;
    content.textContent = accumulated;
    if (container) scrollToBottom(container);
  }

  function finalize(finalContent: string): void {
    accumulated = finalContent || accumulated;
    msg.content = accumulated;
    content.textContent = accumulated;
    bubble.classList.remove("ai-msg--streaming");
    cursor.remove();
    bubble.appendChild(makeCopyBtn(() => accumulated));
    if (container) scrollToBottom(container);
  }

  function setError(message: string, onRetry?: () => void): void {
    bubble.remove();
    // Remove only this message's entry from history by index, not the last one (EC-10)
    if (_history[side][msgIndex] === msg) {
      _history[side].splice(msgIndex, 1);
    }

    const errBubble = document.createElement("div");
    errBubble.className = "ai-msg ai-msg--error";
    errBubble.textContent = message;

    if (onRetry) {
      const retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = "ai-retry-btn";
      retryBtn.textContent = "Retry";
      retryBtn.addEventListener("click", onRetry);
      errBubble.appendChild(retryBtn);
    }

    container?.appendChild(errBubble);
    if (container) scrollToBottom(container);
  }

  return { appendToken, finalize, setError };
}

/** Append a tool-call status chip (web search, fetch_url) inside the messages area. */
export function appendToolCallChip(side: PaneSide, label: string): void {
  const container = getMessagesEl(side);
  if (!container) return;
  const chip = document.createElement("div");
  chip.className = "ai-tool-chip";
  chip.textContent = label;
  container.appendChild(chip);
  scrollToBottom(container);
}

/**
 * Append source attribution links after a grounded response (Story 4.2).
 * sources: [{query, url?, title?}]
 */
export function appendSourceAttribution(
  side: PaneSide,
  sources: Array<{ query?: string; url?: string; title?: string }>,
): void {
  if (!sources || sources.length === 0) return;
  const container = getMessagesEl(side);
  if (!container) return;

  const wrapper = document.createElement("div");
  wrapper.className = "ai-sources";

  const label = document.createElement("span");
  label.className = "ai-sources-label";
  label.textContent = "Web sources:";
  wrapper.appendChild(label);

  for (const src of sources) {
    const chip = document.createElement("span");
    chip.className = "ai-source-chip";
    if (src.url) {
      // Guard: only allow http/https URLs — block javascript:, file:, etc. (F-09/EC-23)
      let safeUrl: string | null = null;
      try {
        const parsed = new URL(src.url);
        if (parsed.protocol === "https:" || parsed.protocol === "http:") {
          safeUrl = src.url;
        }
      } catch {
        /* invalid URL — fall through to text-only rendering */
      }

      if (safeUrl) {
        const a = document.createElement("a");
        a.href = safeUrl;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = src.title ?? src.query ?? safeUrl;
        chip.appendChild(a);
      } else {
        chip.textContent = src.title ?? src.query ?? "(source)";
      }
    } else {
      chip.textContent = src.query ?? "(source)";
    }
    wrapper.appendChild(chip);
  }

  container.appendChild(wrapper);
  scrollToBottom(container);
}

/** Show / hide the "Partial document used" warning chip. */
export function setContextTruncatedWarning(side: PaneSide, visible: boolean): void {
  const container = getMessagesEl(side);
  if (!container) return;
  let chip = container.querySelector(".ai-truncated-chip") as HTMLElement | null;
  if (visible && !chip) {
    chip = document.createElement("div");
    chip.className = "ai-truncated-chip";
    chip.textContent = "Partial document used (context trimmed)";
    // Insert before last message
    const lastMsg = container.lastElementChild;
    if (lastMsg) container.insertBefore(chip, lastMsg);
    else container.appendChild(chip);
  } else if (!visible && chip) {
    chip.remove();
  }
}

/** Clear all message bubbles for a pane.
 *
 * EC-11: We splice the array in place rather than replacing it so that any
 * in-flight `startAssistantMessage` closure that captured a reference to
 * `_history[side][msgIndex]` keeps a coherent (empty) array without the
 * index going stale.
 */
export function clearMessages(side: PaneSide): void {
  _history[side].splice(0);
  const container = getMessagesEl(side);
  if (!container) return;
  container.innerHTML = "";
  // Re-add empty status
  const status = document.createElement("div");
  status.className = "ai-chat-status";
  status.id = `ai-chat-status-${side}`;
  container.appendChild(status);
}

/** Return the message history for a pane (read-only copy). */
export function getMessages(side: PaneSide): ChatMessage[] {
  return [..._history[side]];
}
