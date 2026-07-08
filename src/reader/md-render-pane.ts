/**
 * Markdown rendering for LeapReader.
 *
 * Parses raw Markdown to sanitised HTML using `marked`, then mounts a
 * two-view UI (rendered Preview / raw Source) inside the pane's doc-view
 * element.  The active view is persisted in sessionStorage per pane so that
 * it survives in-session document switches.
 */

import { marked } from "marked";
import type { PaneSide } from "./types";

const SESSION_KEY_PREFIX = "md-view-";

type MdViewMode = "preview" | "source";

function getStoredViewMode(side: PaneSide): MdViewMode {
  const stored = sessionStorage.getItem(`${SESSION_KEY_PREFIX}${side}`);
  return stored === "source" ? "source" : "preview";
}

function storeViewMode(side: PaneSide, mode: MdViewMode): void {
  sessionStorage.setItem(`${SESSION_KEY_PREFIX}${side}`, mode);
}

/**
 * Strip XSS vectors from parsed HTML.
 * Uses DOMParser so we get proper tag awareness — no regex over raw HTML.
 */
function sanitizeHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Remove any <script> elements entirely.
  doc.querySelectorAll("script").forEach((el) => el.remove());

  // Walk every element and strip dangerous attributes.
  const walker = document.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  let node: Node | null = walker.nextNode();
  while (node) {
    const el = node as Element;
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.toLowerCase().trimStart();
      if (name.startsWith("on") || value.startsWith("javascript:") || value.startsWith("data:text/html")) {
        el.removeAttribute(attr.name);
      }
    }
    node = walker.nextNode();
  }

  return doc.body.innerHTML;
}

/**
 * Parse Markdown → sanitised HTML.
 * Exported so doc-session can call it when building docHtml.
 */
export function parseMarkdown(rawMd: string): string {
  // marked.parse() is synchronous when async option is not set.
  const rawHtml = marked.parse(rawMd) as string;
  return sanitizeHtml(rawHtml);
}

/**
 * Mount the Markdown viewer (toolbar + rendered/source views) inside
 * `docViewEl`.  The caller is responsible for setting `docViewEl.hidden = false`
 * and `docViewEl.dataset.docType = "md"` after this call.
 */
export function mountMdDocView(
  side: PaneSide,
  rawMd: string,
  renderedHtml: string,
  docViewEl: HTMLElement
): void {
  const mode = getStoredViewMode(side);

  // ── Toolbar ──────────────────────────────────────────────────────────────
  const toolbar = document.createElement("div");
  toolbar.className = "md-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Markdown view");

  const previewBtn = document.createElement("button");
  previewBtn.type = "button";
  previewBtn.className = "btn btn-compact md-toggle-btn";
  previewBtn.dataset.mdView = "preview";
  previewBtn.textContent = "Preview";
  previewBtn.setAttribute("aria-pressed", String(mode === "preview"));

  const sourceBtn = document.createElement("button");
  sourceBtn.type = "button";
  sourceBtn.className = "btn btn-compact md-toggle-btn";
  sourceBtn.dataset.mdView = "source";
  sourceBtn.textContent = "Source";
  sourceBtn.setAttribute("aria-pressed", String(mode === "source"));

  toolbar.appendChild(previewBtn);
  toolbar.appendChild(sourceBtn);

  // ── Preview pane ─────────────────────────────────────────────────────────
  const previewDiv = document.createElement("div");
  previewDiv.className = "md-render-pane";
  previewDiv.innerHTML = renderedHtml;
  if (mode !== "preview") previewDiv.setAttribute("hidden", "");

  // ── Source pane ──────────────────────────────────────────────────────────
  const sourcePre = document.createElement("pre");
  sourcePre.className = "md-source-pane";
  sourcePre.textContent = rawMd;
  if (mode !== "source") sourcePre.setAttribute("hidden", "");

  // ── Mount ────────────────────────────────────────────────────────────────
  docViewEl.replaceChildren(toolbar, previewDiv, sourcePre);

  // ── Toggle handler ───────────────────────────────────────────────────────
  const applyMode = (newMode: MdViewMode): void => {
    storeViewMode(side, newMode);

    if (newMode === "preview") {
      previewDiv.removeAttribute("hidden");
      sourcePre.setAttribute("hidden", "");
    } else {
      previewDiv.setAttribute("hidden", "");
      sourcePre.removeAttribute("hidden");
    }

    previewBtn.setAttribute("aria-pressed", String(newMode === "preview"));
    sourceBtn.setAttribute("aria-pressed", String(newMode === "source"));
  };

  previewBtn.addEventListener("click", () => applyMode("preview"));
  sourceBtn.addEventListener("click", () => applyMode("source"));
}
