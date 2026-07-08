/**
 * AI Review — Stories 3.3 + 3.4
 *
 * Frontend trigger for the paper review workflow.
 * Shows tool-call status chips during the ReAct agent loop.
 * Provides "Review offline" fallback (no web search).
 */

import type { PaneSide } from "./types";
import { session } from "./session";
import { setAiPanelOpen, getBackendPort, warmContextCache } from "./ai-panel";
import { appendUserMessage, startAssistantMessage, setContextTruncatedWarning } from "./ai-chat";
import { showToast } from "./chrome-toolbar";
import { getActiveModel } from "./ai-constants";

function getPdfPath(side: PaneSide): string | null {
  return session.paneState[side].storageId ?? null;
}

/** Show a tool-call chip in the messages area. Returns a cleanup fn. */
function showToolChip(
  side: PaneSide,
  tool: string,
  args: Record<string, string>
): () => void {
  const container = document.getElementById(`ai-chat-messages-${side}`);
  if (!container) return () => {};

  const chip = document.createElement("div");
  chip.className = "ai-tool-chip";
  const label = tool === "web_search"
    ? `🔍 Searching: "${args.query ?? ""}"`
    : `🌐 Fetching: ${args.url ?? ""}`;
  chip.textContent = label;
  container.appendChild(chip);
  container.scrollTop = container.scrollHeight;

  return () => chip.classList.add("ai-tool-chip--done");
}

export async function runReview(side: PaneSide, offline = false): Promise<void> {
  const port = getBackendPort();
  if (!port) {
    showToast("AI is not ready yet");
    return;
  }

  const pdfPath = getPdfPath(side);
  if (!pdfPath) {
    showToast("Open a PDF document to review");
    return;
  }

  setAiPanelOpen(side, true);
  await warmContextCache(side);

  const label = offline ? "Review document (offline)" : "Review document";
  appendUserMessage(side, label);
  const { appendToken, finalize, setError } = startAssistantMessage(side);

  const sessionId = crypto.randomUUID();
  const url = `http://127.0.0.1:${port}/review/${side}/${sessionId}`;
  const body = JSON.stringify({
    pane_id: side,
    session_id: sessionId,
    pdf_path: pdfPath,
    model: getActiveModel(),
    offline,
  });

  const activeChipCleanups: Map<string, () => void> = new Map();
  const abortController = new AbortController();

  // Register this review stream so the Stop button can abort it (EC-06)
  const ai = (window as unknown as Record<string, unknown>).leapReaderAI as Record<string, Function> | undefined;
  const stopBtn = document.getElementById(`ai-stop-${side}`) as HTMLButtonElement | null;
  const sendBtn = document.getElementById(`ai-send-${side}`) as HTMLButtonElement | null;
  if (stopBtn) stopBtn.removeAttribute("hidden");
  if (sendBtn) sendBtn.disabled = true;

  const onStop = () => {
    abortController.abort();
    void ai?.abortStream?.(side, sessionId, "review");
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
          const evt = JSON.parse(raw) as {
            type: string;
            pane_id: string;
            payload: Record<string, unknown>;
          };
          if (evt.pane_id !== side) continue;

          if (evt.type === "token") {
            appendToken(String(evt.payload.text ?? ""));
            // Mark any in-progress tool chip as done on first token
            activeChipCleanups.forEach((cleanup) => cleanup());
            activeChipCleanups.clear();
          } else if (evt.type === "tool_call") {
            const tool = String(evt.payload.tool ?? "");
            const args = (evt.payload.args ?? {}) as Record<string, string>;
            const cleanup = showToolChip(side, tool, args);
            activeChipCleanups.set(`${tool}-${Date.now()}`, cleanup);
          } else if (evt.type === "meta") {
            if (evt.payload.context_truncated) setContextTruncatedWarning(side, true);
          } else if (evt.type === "error") {
            const code = String(evt.payload.code ?? "");
            if (code !== "ABORTED") {
              setError(String(evt.payload.message || "Review error"), () => void runReview(side, offline));
            } else {
              finalize("");
            }
          }
        } catch { /* skip */ }
      }
    }
    finalize("");
  } catch (err: unknown) {
    if ((err as Error)?.name === "AbortError") {
      finalize("");
    } else {
      setError((err as Error)?.message ?? "Review failed", () => void runReview(side, offline));
    }
  } finally {
    activeChipCleanups.forEach((cleanup) => cleanup());
    activeChipCleanups.clear();
    stopBtn?.removeEventListener("click", onStop);
    if (stopBtn) stopBtn.setAttribute("hidden", "");
    if (sendBtn) {
      const textarea = document.getElementById(`ai-input-${side}`) as HTMLTextAreaElement | null;
      sendBtn.disabled = textarea?.value.trim() === "";
    }
  }
}
