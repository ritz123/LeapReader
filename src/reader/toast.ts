let activeTimer: number | null = null;

/**
 * Show a brief notification toast.
 * Cancels any in-flight toast before showing a new one so rapid calls
 * don't stack timers and leave the toast stuck on-screen.
 */
export function showToast(message: string, durationMs = 2000): void {
  const el = document.getElementById("toast");
  if (!el) return;
  if (activeTimer !== null) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }
  el.textContent = message;
  el.hidden = false;
  activeTimer = window.setTimeout((): void => {
    el.hidden = true;
    activeTimer = null;
  }, durationMs);
}
