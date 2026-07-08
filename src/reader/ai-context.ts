/**
 * AI Context — Story 2.4
 *
 * Extracts text from the PDF loaded in a given pane using pdfjs (AD-7).
 * Limited to 8000 tokens (~32000 chars) for Chat/Summarize (AD-7).
 *
 * Also handles:
 *   - Document name badge updates in the AI panel header
 *   - Document-change banner when a new doc is loaded mid-session
 */

import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { session } from "./session";
import type { PaneSide } from "./types";
import { setAiDocName } from "./ai-panel";

const MAX_CONTEXT_CHARS = 32_000; // ≈ 8000 tokens at 4 chars/token

/** Extract up to MAX_CONTEXT_CHARS of text from the pane's current document. */
export async function extractPaneContextText(side: PaneSide): Promise<string> {
  const st = session.paneState[side];

  // For Markdown files, return the raw source text directly — no PDF extraction needed.
  if (st.docRaw !== null) {
    return st.docRaw.slice(0, MAX_CONTEXT_CHARS);
  }

  const pdfDoc = st.doc;
  if (!pdfDoc) return "";

  const pages: string[] = [];
  let totalChars = 0;

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    if (totalChars >= MAX_CONTEXT_CHARS) break;
    try {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .filter((item): item is TextItem => "str" in item)
        .map((item) => item.str)
        .join(" ");
      pages.push(pageText);
      totalChars += pageText.length;
    } catch {
      /* skip unreadable pages */
    }
  }

  const full = pages.join("\n");
  return full.slice(0, MAX_CONTEXT_CHARS);
}

/** Return the file name for the document loaded in a pane, or null. */
export function getPaneDocName(side: PaneSide): string | null {
  const name = session.paneState[side].name;
  return name || null;
}

/**
 * Call whenever a pane's document changes.
 * Updates the AI panel header badge and (if the chat is open) shows a banner.
 */
export function onPaneDocChanged(side: PaneSide): void {
  const name = getPaneDocName(side);
  setAiDocName(side, name);

  // Show document-change banner if panel is already open with messages
  const messagesEl = document.getElementById(`ai-chat-messages-${side}`);
  if (!messagesEl) return;
  const hasMessages = messagesEl.querySelectorAll(".ai-msg").length > 0;
  if (!hasMessages) return;

  const bannerId = `ai-doc-change-banner-${side}`;
  if (document.getElementById(bannerId)) return;

  const banner = document.createElement("div");
  banner.id = bannerId;
  banner.className = "ai-doc-change-banner";
  banner.textContent = "Document changed — clear chat to use the new document as context";

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "ai-retry-btn";
  clearBtn.textContent = "Clear";
  clearBtn.addEventListener("click", () => {
    banner.remove();
    // clearChat is wired in Story 2.5
    document.getElementById(`ai-clear-btn-${side}`)?.click();
  });
  banner.appendChild(clearBtn);

  const dismissBtn = document.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.className = "ai-retry-btn";
  dismissBtn.textContent = "Dismiss";
  dismissBtn.style.marginLeft = "0.25rem";
  dismissBtn.addEventListener("click", () => banner.remove());
  banner.appendChild(dismissBtn);

  messagesEl.insertBefore(banner, messagesEl.firstChild);
}
