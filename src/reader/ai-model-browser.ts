/**
 * AI Model Browser — Story 4.3
 *
 * Lets the user view locally available Ollama models and switch the active
 * model. The model badge in the AI panel header is a button; clicking it
 * opens an inline listbox populated from GET /models/. The selected model
 * is persisted to localStorage under AI_MODEL_KEY (shared with ai-input.ts).
 */

import type { PaneSide } from "./types";
import { getBackendPort } from "./ai-panel";
import { getActiveModel, setActiveModel, getOllamaUrl, setOllamaUrl } from "./ai-constants";

interface OllamaModel {
  name: string;
  size?: number;
}

function formatBytes(bytes?: number): string {
  if (!bytes) return "";
  const gb = bytes / 1e9;
  return gb >= 1 ? ` (${gb.toFixed(1)} GB)` : ` (${(bytes / 1e6).toFixed(0)} MB)`;
}

async function fetchModels(): Promise<OllamaModel[] | null> {
  const port = getBackendPort();
  if (!port) return null;
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/models/`);
    if (!resp.ok) return [];
    const data = await resp.json() as { models?: OllamaModel[] };
    return data.models ?? [];
  } catch {
    return [];
  }
}

async function applyOllamaUrl(
  port: number,
  url: string,
): Promise<{ ok: boolean; error?: string; models?: OllamaModel[] }> {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/config/ollama`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await resp.json() as { ok: boolean; error?: string; models?: OllamaModel[] };
    return data;
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? "Network error" };
  }
}

function updateBadgeLabel(side: PaneSide, model: string): void {
  const badge = document.getElementById(`ai-model-badge-${side}`) as HTMLButtonElement | null;
  if (!badge) return;
  badge.textContent = model;
  badge.title = `Active model: ${model} — click to switch`;
}

function buildModelPicker(
  pickerEl: HTMLElement,
  models: OllamaModel[] | null,
  onSelect: (name: string) => void,
  onPullRequest: (modelName: string) => void,
  onRefresh: () => void,
  onUrlChange: (url: string, statusEl: HTMLElement) => Promise<void>,
): void {
  pickerEl.innerHTML = "";

  // ── Server URL row ──────────────────────────────────────────────────────
  const urlRow = document.createElement("div");
  urlRow.className = "ai-server-url-row";

  const urlLabel = document.createElement("label");
  urlLabel.className = "ai-server-url-label";
  urlLabel.textContent = "Ollama server";

  const urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.className = "ai-server-url-input";
  urlInput.value = getOllamaUrl();
  urlInput.placeholder = "http://localhost:11434";
  urlInput.spellcheck = false;
  urlInput.setAttribute("aria-label", "Ollama server URL");

  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "btn btn-compact ai-server-url-apply";
  applyBtn.textContent = "Apply";

  const urlStatus = document.createElement("span");
  urlStatus.className = "ai-server-url-status";

  applyBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const url = urlInput.value.trim();
    if (!url) return;
    applyBtn.disabled = true;
    urlStatus.textContent = "Connecting…";
    urlStatus.className = "ai-server-url-status";
    await onUrlChange(url, urlStatus);
    applyBtn.disabled = false;
  });

  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); applyBtn.click(); }
  });

  urlRow.appendChild(urlLabel);
  urlRow.appendChild(urlInput);
  urlRow.appendChild(applyBtn);
  urlRow.appendChild(urlStatus);
  pickerEl.appendChild(urlRow);

  // ── Header with refresh button ──────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "ai-model-picker-header";
  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.className = "ai-model-picker-refresh";
  refreshBtn.title = "Refresh model list";
  refreshBtn.textContent = "↻";
  refreshBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    onRefresh();
  });
  header.appendChild(refreshBtn);
  pickerEl.appendChild(header);

  const current = getActiveModel();
  const sortedModels = models ? [...models].sort((a, b) => a.name.localeCompare(b.name)) : null;

  if (sortedModels === null) {
    const empty = document.createElement("div");
    empty.className = "ai-model-picker-empty";
    empty.textContent = "AI backend not ready";
    pickerEl.appendChild(empty);
  } else if (sortedModels.length === 0) {
    const empty = document.createElement("div");
    empty.className = "ai-model-picker-empty";
    empty.textContent = "No models found — pull one below";
    pickerEl.appendChild(empty);
  } else {
    for (const m of sortedModels) {
      const item = document.createElement("div");
      item.className = "ai-model-picker-item";
      if (m.name === current) item.classList.add("ai-model-picker-item--active");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(m.name === current));
      item.tabIndex = 0;

      const name = document.createElement("span");
      name.className = "ai-model-picker-name";
      name.textContent = m.name;

      const size = document.createElement("span");
      size.className = "ai-model-picker-size";
      size.textContent = formatBytes(m.size);

      item.appendChild(name);
      item.appendChild(size);

      const handleSelect = () => {
        onSelect(m.name);
        pickerEl.setAttribute("hidden", "");
      };

      item.addEventListener("click", handleSelect);
      item.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleSelect();
        }
      });

      pickerEl.appendChild(item);
    }
  }

  // Pull another model row (Story 4.4)
  // The default model (llama3.2:3b) is downloaded automatically on startup.
  // This row is for pulling any additional models the user wants.
  const pullRow = document.createElement("div");
  pullRow.className = "ai-model-pull-row";

  const pullLabel = document.createElement("div");
  pullLabel.className = "ai-model-pull-label";
  pullLabel.textContent = "Pull another model";
  pullRow.appendChild(pullLabel);

  const pullInput = document.createElement("input");
  pullInput.type = "text";
  pullInput.className = "ai-model-pull-input";
  pullInput.placeholder = "llama3.2:3b";
  pullInput.setAttribute("aria-label", "Model name to pull");

  const pullBtn = document.createElement("button");
  pullBtn.type = "button";
  pullBtn.className = "btn btn-compact ai-model-pull-btn";
  pullBtn.textContent = "Pull";
  pullBtn.disabled = true;

  const pullStatus = document.createElement("div");
  pullStatus.className = "ai-model-pull-status";
  pullStatus.hidden = true;

  const pullBarWrap = document.createElement("div");
  pullBarWrap.className = "ai-model-pull-bar-wrap";
  const pullBar = document.createElement("div");
  pullBar.className = "ai-model-pull-bar";
  pullBarWrap.appendChild(pullBar);

  pullInput.addEventListener("input", () => {
    pullBtn.disabled = pullInput.value.trim() === "";
  });

  pullInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !pullBtn.disabled) pullBtn.click();
  });

  pullBtn.addEventListener("click", () => {
    const name = pullInput.value.trim();
    if (!name) return;
    pullInput.value = "";
    pullBtn.disabled = true;
    pullStatus.hidden = false;
    pullStatus.textContent = `Pulling ${name}…`;
    pullBarWrap.classList.add("visible");
    pullBar.classList.add("indeterminate");
    onPullRequest(name);
  });

  pullRow.appendChild(pullInput);
  pullRow.appendChild(pullBtn);
  pullRow.appendChild(pullStatus);
  pullRow.appendChild(pullBarWrap);
  pickerEl.appendChild(pullRow);
}

/** Re-query the status element each time it's needed so stale references
 * from a previous picker build are not used (EC-13). */
function getLiveStatusEl(side: PaneSide): HTMLElement | null {
  return document
    .getElementById(`ai-model-picker-${side}`)
    ?.querySelector(".ai-model-pull-status") as HTMLElement | null ?? null;
}

function getLiveBarWrapEl(side: PaneSide): HTMLElement | null {
  return document
    .getElementById(`ai-model-picker-${side}`)
    ?.querySelector(".ai-model-pull-bar-wrap") as HTMLElement | null ?? null;
}

function getLiveBarEl(side: PaneSide): HTMLElement | null {
  return document
    .getElementById(`ai-model-picker-${side}`)
    ?.querySelector(".ai-model-pull-bar") as HTMLElement | null ?? null;
}

/** Refresh only the model list items inside the picker (keeps the header and pull row intact). */
async function refreshPickerModels(side: PaneSide, onSelect: (name: string) => void): Promise<void> {
  const pickerEl = document.getElementById(`ai-model-picker-${side}`);
  if (!pickerEl || pickerEl.hasAttribute("hidden")) return;
  const models = await fetchModels();
  const current = getActiveModel();

  // Remove only list items and empty state (leave header and pull row in place)
  pickerEl.querySelectorAll(".ai-model-picker-item, .ai-model-picker-empty").forEach((el) => el.remove());

  const pullRow = pickerEl.querySelector(".ai-model-pull-row");
  const sortedModels = models ? [...models].sort((a, b) => a.name.localeCompare(b.name)) : null;

  if (sortedModels === null) {
    const empty = document.createElement("div");
    empty.className = "ai-model-picker-empty";
    empty.textContent = "AI backend not ready";
    pickerEl.insertBefore(empty, pullRow);
  } else if (sortedModels.length === 0) {
    const empty = document.createElement("div");
    empty.className = "ai-model-picker-empty";
    empty.textContent = "No models found — pull one below";
    pickerEl.insertBefore(empty, pullRow);
  } else {
    for (const m of sortedModels) {
      const item = document.createElement("div");
      item.className = "ai-model-picker-item";
      if (m.name === current) item.classList.add("ai-model-picker-item--active");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(m.name === current));
      item.tabIndex = 0;

      const nameEl = document.createElement("span");
      nameEl.className = "ai-model-picker-name";
      nameEl.textContent = m.name;

      const sizeEl = document.createElement("span");
      sizeEl.className = "ai-model-picker-size";
      sizeEl.textContent = formatBytes(m.size);

      item.appendChild(nameEl);
      item.appendChild(sizeEl);

      const handleSelect = () => { onSelect(m.name); };
      item.addEventListener("click", handleSelect);
      item.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSelect(); }
      });

      pickerEl.insertBefore(item, pullRow);
    }
  }
}

async function pullModel(side: PaneSide, modelName: string, onSelect: (name: string) => void): Promise<void> {
  const port = getBackendPort();
  if (!port) {
    // Backend not ready — clear the "Pulling…" text the click handler already set
    const statusEl = getLiveStatusEl(side);
    const barEl = getLiveBarEl(side);
    if (statusEl) statusEl.textContent = "AI not ready — try again later";
    if (barEl) barEl.classList.remove("indeterminate");
    setTimeout(() => {
      const el = getLiveStatusEl(side);
      const w = getLiveBarWrapEl(side);
      if (el) el.hidden = true;
      if (w) w.classList.remove("visible");
    }, 2500);
    return;
  }

  let finished = false;

  const finish = (success: boolean, message: string) => {
    if (finished) return;
    finished = true;

    const statusEl = getLiveStatusEl(side);
    const barEl = getLiveBarEl(side);

    if (statusEl) statusEl.textContent = message;
    if (barEl) {
      barEl.classList.remove("indeterminate");
      barEl.style.width = success ? "100%" : "0%";
    }

    setTimeout(async () => {
      const el = getLiveStatusEl(side);
      const bw = getLiveBarWrapEl(side);
      if (el) el.hidden = true;
      if (bw) bw.classList.remove("visible");
      if (success) await refreshPickerModels(side, onSelect);
    }, 2000);
  };

  try {
    const resp = await fetch(`http://127.0.0.1:${port}/models/pull/${encodeURIComponent(modelName)}`);
    if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

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
          const ev = JSON.parse(raw) as {
            type: string;
            payload?: { status?: string; percent?: number };
          };

          if (ev.type === "pull_progress") {
            const pct = ev.payload?.percent ?? 0;
            const st = ev.payload?.status ?? "downloading";

            if (st === "already_present") {
              finish(true, `✓ ${modelName} already downloaded`);
              return;
            }

            const barEl = getLiveBarEl(side);
            const statusEl = getLiveStatusEl(side);

            if (pct > 0 && barEl) {
              barEl.classList.remove("indeterminate");
              barEl.style.width = `${pct}%`;
            }
            if (statusEl) {
              statusEl.textContent = pct > 0
                ? `${modelName}: ${st} ${pct}%`
                : `${modelName}: ${st}…`;
            }

            if (pct >= 100) finish(true, `✓ ${modelName} ready`);
          } else if (ev.type === "error") {
            finish(false, `Error pulling ${modelName}`);
          }
        } catch {
          /* skip malformed SSE lines */
        }
      }
    }
  } catch (err) {
    const statusEl = getLiveStatusEl(side);
    const barEl = getLiveBarEl(side);
    if (statusEl) {
      statusEl.textContent = `Failed: ${(err as Error)?.message ?? "unknown"}`;
    }
    if (barEl) barEl.classList.remove("indeterminate");
    setTimeout(() => {
      const el = getLiveStatusEl(side);
      const w = getLiveBarWrapEl(side);
      if (el) el.hidden = true;
      if (w) w.classList.remove("visible");
    }, 3000);
  }
}

export function initModelBrowser(side: PaneSide): void {
  const badgeBtn = document.getElementById(`ai-model-badge-${side}`) as HTMLButtonElement | null;
  const pickerEl = document.getElementById(`ai-model-picker-${side}`) as HTMLElement | null;
  if (!badgeBtn || !pickerEl) return;

  // Set initial badge
  updateBadgeLabel(side, getActiveModel());

  let pickerOpen = false;

  badgeBtn.addEventListener("click", async () => {
    pickerOpen = !pickerOpen;
    if (!pickerOpen) {
      pickerEl.setAttribute("hidden", "");
      return;
    }

    pickerEl.textContent = "Loading…";
    pickerEl.removeAttribute("hidden");

    const models = await fetchModels();

    const onSelect = (name: string) => {
      setActiveModel(name);
      updateBadgeLabel(side, name);
      pickerEl.setAttribute("hidden", "");
      pickerOpen = false;
    };

    const onUrlChange = async (url: string, statusEl: HTMLElement) => {
      const port = getBackendPort();
      if (!port) { statusEl.textContent = "Backend not ready"; return; }
      const result = await applyOllamaUrl(port, url);
      if (result.ok) {
        setOllamaUrl(url);
        statusEl.textContent = "✓ Connected";
        statusEl.className = "ai-server-url-status ai-server-url-status--ok";
        // Refresh model list with the newly returned models
        const newModels = result.models ?? null;
        pickerEl.querySelectorAll(".ai-model-picker-item, .ai-model-picker-empty").forEach((el) => el.remove());
        const pullRow = pickerEl.querySelector(".ai-model-pull-row");
        const sorted = newModels ? [...newModels].sort((a, b) => a.name.localeCompare(b.name)) : null;
        if (!sorted || sorted.length === 0) {
          const empty = document.createElement("div");
          empty.className = "ai-model-picker-empty";
          empty.textContent = sorted ? "No models found — pull one below" : "No models";
          pickerEl.insertBefore(empty, pullRow);
        } else {
          for (const m of sorted) {
            const item = document.createElement("div");
            item.className = "ai-model-picker-item";
            if (m.name === getActiveModel()) item.classList.add("ai-model-picker-item--active");
            item.setAttribute("role", "option");
            item.setAttribute("aria-selected", String(m.name === getActiveModel()));
            item.tabIndex = 0;
            const nameEl = document.createElement("span");
            nameEl.className = "ai-model-picker-name";
            nameEl.textContent = m.name;
            const sizeEl = document.createElement("span");
            sizeEl.className = "ai-model-picker-size";
            sizeEl.textContent = formatBytes(m.size);
            item.appendChild(nameEl);
            item.appendChild(sizeEl);
            const handleSelect = () => { onSelect(m.name); };
            item.addEventListener("click", handleSelect);
            item.addEventListener("keydown", (e) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSelect(); }
            });
            pickerEl.insertBefore(item, pullRow);
          }
        }
      } else {
        statusEl.textContent = `✗ ${result.error ?? "Failed"}`;
        statusEl.className = "ai-server-url-status ai-server-url-status--err";
      }
    };

    buildModelPicker(
      pickerEl,
      models,
      onSelect,
      (modelName) => {
        void pullModel(side, modelName, onSelect);
      },
      () => {
        void refreshPickerModels(side, onSelect);
      },
      onUrlChange,
    );
  });

  // Close picker when clicking outside
  document.addEventListener("click", (e) => {
    if (!pickerEl.hasAttribute("hidden")) {
      const target = e.target as Node;
      if (!pickerEl.contains(target) && target !== badgeBtn) {
        pickerEl.setAttribute("hidden", "");
        pickerOpen = false;
      }
    }
  });
}

/** Called after backend becomes ready — refresh badge label from storage. */
export function refreshModelBadge(side: PaneSide): void {
  updateBadgeLabel(side, getActiveModel());
}
