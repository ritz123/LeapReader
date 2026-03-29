/**
 * Minimum time the splash stays visible from navigation start (performance.now()).
 * Fast boots otherwise only added ~0.5s after load — not enough to read copy.
 */
const SPLASH_MIN_SINCE_NAV_MS = 5200;

const SPLASH_FADE_MS = 700;

/**
 * Fades out and removes the startup splash after layout has settled.
 * Call once at the end of app bootstrap.
 */
export function dismissSplashWhenReady(): void {
  const el = document.getElementById("app-splash");
  if (!el) return;

  const run = (): void => {
    const elapsedSinceNav = performance.now();
    const waitMs = Math.max(0, SPLASH_MIN_SINCE_NAV_MS - elapsedSinceNav);
    window.setTimeout(() => {
      el.setAttribute("aria-busy", "false");
      el.classList.add("app-splash--exiting");
      const remove = (): void => {
        el.remove();
      };
      el.addEventListener("transitionend", remove, { once: true });
      window.setTimeout(remove, SPLASH_FADE_MS + 100);
    }, waitMs);
  };

  requestAnimationFrame(() => requestAnimationFrame(run));
}
