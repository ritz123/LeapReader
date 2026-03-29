import { showToast, updateSelectionButtons } from "./chrome-toolbar";

export async function copySelectionToClipboard(): Promise<void> {
  const text = window.getSelection()?.toString().trim() ?? "";
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  showToast("Copied to clipboard");
  window.getSelection()?.removeAllRanges();
  updateSelectionButtons();
}
