/**
 * AI Input Row — Story 2.3
 *
 * Provides the text input field, Send button, and Stop button for each pane.
 * Manages SSE connections to the backend chat endpoint.
 * Implements the 4-layer abort chain (AD-13):
 *   1. User clicks Stop → abortStream IPC to Main
 *   2. Main → DELETE /chat/{pane_id}/{session_id} to backend
 *   3. Backend cancels asyncio task → emits SSE error {code:"ABORTED"}
 *   4. Renderer receives ABORTED → clears generation indicator
 */

import type { PaneSide } from "./types";
import {
  appendUserMessage,
  appendToolCallChip,
  appendSourceAttribution,
  setContextTruncatedWarning,
  startAssistantMessage,
} from "./ai-chat";
import { getBackendPort } from "./ai-panel";
import { getActiveModel } from "./ai-constants";

interface StreamState {
  sessionId: string;
  abortController: AbortController;
}

// At most one active stream per pane (AD-13)
const _activeStream: Partial<Record<PaneSide, StreamState>> = {};

// Web search toggle state per pane (FR-10)
const _webSearch: Partial<Record<PaneSide, boolean>> = {};

function newSessionId(): string {
  return crypto.randomUUID();
}

/** Stamp the chat input row HTML into the placeholder div, then wire events. */
export function initAiInputRow(side: PaneSide, getContextText: () => string): void {
  const rowEl = document.getElementById(`ai-chat-input-row-${side}`);
  if (!rowEl) return;

  rowEl.innerHTML = `
    <textarea
      id="ai-input-${side}"
      class="ai-input"
      placeholder="Ask about this document…"
      rows="2"
      aria-label="Message to AI (${side} pane)"
    ></textarea>
    <div class="ai-input-actions">
      <button
        type="button"
        class="btn btn-compact ai-web-toggle"
        id="ai-web-toggle-${side}"
        title="Toggle web search grounding"
        aria-pressed="false"
      >🌐</button>
      <button type="button" class="btn btn-compact ai-send-btn" id="ai-send-${side}" disabled>Send</button>
      <button type="button" class="btn btn-compact ai-stop-btn" id="ai-stop-${side}" hidden>Stop</button>
    </div>
  `;
  rowEl.removeAttribute("hidden");

  const textarea = document.getElementById(`ai-input-${side}`) as HTMLTextAreaElement;
  const sendBtn = document.getElementById(`ai-send-${side}`) as HTMLButtonElement;
  const stopBtn = document.getElementById(`ai-stop-${side}`) as HTMLButtonElement;
  const webToggle = document.getElementById(`ai-web-toggle-${side}`) as HTMLButtonElement;

  _webSearch[side] = false;
  webToggle.title = "Prefer web search (AI can always use tools autonomously)";
  webToggle.addEventListener("click", () => {
    _webSearch[side] = !_webSearch[side];
    webToggle.setAttribute("aria-pressed", String(_webSearch[side]));
    webToggle.classList.toggle("ai-web-toggle--active", _webSearch[side] ?? false);
    webToggle.title = _webSearch[side]
      ? "Web-grounded mode ON — AI will search proactively. Click to disable."
      : "Prefer web search (AI can always use tools autonomously)";
  });

  textarea.addEventListener("input", () => {
    sendBtn.disabled = textarea.value.trim() === "" || !!_activeStream[side];
  });

  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) sendBtn.click();
    }
  });

  sendBtn.addEventListener("click", () => {
    const text = textarea.value.trim();
    if (!text || _activeStream[side]) return;
    textarea.value = "";
    sendBtn.disabled = true;
    void submitChat(side, text, getContextText(), () => sendBtn.disabled = textarea.value.trim() === "");
  });

  stopBtn.addEventListener("click", () => {
    void abortCurrentStream(side);
  });
}

function setGenerating(side: PaneSide, generating: boolean): void {
  const sendBtn = document.getElementById(`ai-send-${side}`) as HTMLButtonElement | null;
  const stopBtn = document.getElementById(`ai-stop-${side}`) as HTMLButtonElement | null;
  const textarea = document.getElementById(`ai-input-${side}`) as HTMLTextAreaElement | null;

  if (sendBtn) sendBtn.disabled = generating || textarea?.value.trim() === "";
  if (stopBtn) {
    if (generating) stopBtn.removeAttribute("hidden");
    else stopBtn.setAttribute("hidden", "");
  }
}

async function abortCurrentStream(side: PaneSide): Promise<void> {
  const state = _activeStream[side];
  if (!state) return;
  state.abortController.abort();
  delete _activeStream[side];

  // Best-effort IPC abort → backend DELETE /chat/{pane}/{session} (AD-13)
  const ai = (window as unknown as Record<string, unknown>).leapReaderAI as Record<string, Function> | undefined;
  try {
    await ai?.abortStream?.(side, state.sessionId, "chat");
  } catch {
    /* non-critical */
  }
  setGenerating(side, false);
}

async function submitChat(
  side: PaneSide,
  message: string,
  contextText: string,
  onDone: () => void,
): Promise<void> {
  const port = getBackendPort();
  if (!port) {
    appendUserMessage(side, message);
    const { setError } = startAssistantMessage(side);
    setError("AI is not available yet. Please wait for it to start.", () =>
      void submitChat(side, message, contextText, onDone)
    );
    onDone();
    return;
  }

  const sessionId = newSessionId();
  const abortController = new AbortController();
  _activeStream[side] = { sessionId, abortController };
  setGenerating(side, true);

  appendUserMessage(side, message);
  const { appendToken, finalize, setError } = startAssistantMessage(side);

  const url = `http://127.0.0.1:${port}/chat/${side}/${sessionId}`;
  const body = JSON.stringify({
    pane_id: side,
    session_id: sessionId,
    message,
    context_text: contextText,
    web_search: _webSearch[side] ?? false,
    model: getActiveModel(),
  });

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: abortController.signal,
    });

    if (!resp.ok || !resp.body) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw) continue;
        try {
          const event = JSON.parse(raw) as {
            type: string;
            pane_id: string;
            payload: Record<string, unknown>;
          };
          if (event.pane_id !== side) continue;

          if (event.type === "token") {
            appendToken(String(event.payload.text ?? ""));
          } else if (event.type === "tool_call") {
            const tool = String(event.payload.tool ?? "");
            const args = event.payload.args as Record<string, unknown> | undefined;
            const label = tool === "web_search"
              ? `🔍 ${args?.query ?? ""}`
              : tool === "fetch_url"
              ? `🌐 ${args?.url ?? ""}`
              : `🔧 ${tool}`;
            appendToolCallChip(side, label);
          } else if (event.type === "meta") {
            if (event.payload.context_truncated) {
              setContextTruncatedWarning(side, true);
            }
            if (Array.isArray(event.payload.sources) && event.payload.sources.length > 0) {
              appendSourceAttribution(side, event.payload.sources as Array<{ query?: string; url?: string; title?: string }>);
            }
          } else if (event.type === "error") {
            const code = String(event.payload.code ?? "");
            if (code === "ABORTED") {
              finalize("");
            } else {
              setError(String(event.payload.message || "Stream error"));
            }
          }
        } catch {
          /* malformed JSON line — skip */
        }
      }
    }

    finalize("");
  } catch (err: unknown) {
    if ((err as Error)?.name === "AbortError") {
      finalize("");
    } else {
      const msg = (err as Error)?.message ?? "Connection error";
      setError(msg, () => void submitChat(side, message, contextText, onDone));
    }
  } finally {
    delete _activeStream[side];
    setGenerating(side, false);
    onDone();
  }
}
