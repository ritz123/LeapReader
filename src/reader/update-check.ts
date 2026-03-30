/**
 * Checks GitHub Releases once per day for a newer version and surfaces a
 * banner in the About dialog + a one-time toast notification.
 *
 * Throttle key: "updateCheckAt" — ISO timestamp of last successful check.
 * Result key:   "updateAvailable" — JSON { version, url } or absent.
 */

const REPO = "ritz123/LeapReader";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const LAST_CHECK_KEY = "updateCheckAt";
const UPDATE_KEY = "updateAvailable";

interface UpdateInfo {
  version: string;
  url: string;
  isUpToDate: boolean;
}

/** Compare two semver strings. Returns true if `b` is strictly newer than `a`. */
function isNewer(a: string, b: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number);
  const [aMaj = 0, aMin = 0, aPat = 0] = parse(a);
  const [bMaj = 0, bMin = 0, bPat = 0] = parse(b);
  if (bMaj !== aMaj) return bMaj > aMaj;
  if (bMin !== aMin) return bMin > aMin;
  return bPat > aPat;
}

async function fetchLatestRelease(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      { headers: { Accept: "application/vnd.github+json" } }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { tag_name?: string; html_url?: string };
    if (!data.tag_name || !data.html_url) return null;
    return { version: data.tag_name, url: data.html_url, isUpToDate: false };
  } catch {
    return null;
  }
}

/**
 * Returns true when running as a packaged Electron app or a hosted web build.
 * Skips the check in local dev (unpackaged Electron or localhost web).
 */
async function isProductionBuild(): Promise<boolean> {
  // Electron context: ask the main process
  if (window.leapReaderApp) {
    const { isPackaged } = await window.leapReaderApp.getAppInfo();
    return isPackaged;
  }
  // Web context: skip on localhost / 127.0.0.1
  const host = window.location.hostname;
  return host !== "localhost" && host !== "127.0.0.1";
}

/** Runs the update check (throttled). Call once after startup. */
export async function checkForUpdate(
  onUpdate: (info: UpdateInfo) => void
): Promise<void> {
  if (!(await isProductionBuild())) {
    // Clear any stale update record left from a previous run in packaged mode.
    localStorage.removeItem(UPDATE_KEY);
    localStorage.removeItem(LAST_CHECK_KEY);
    return;
  }
  // Re-surface cached latest version without a network hit.
  const cached = localStorage.getItem(UPDATE_KEY);
  if (cached) {
    try {
      const info = JSON.parse(cached) as UpdateInfo;
      if (info.version && info.url) {
        info.isUpToDate = !isNewer(__APP_VERSION__, info.version);
        onUpdate(info);
      } else {
        localStorage.removeItem(UPDATE_KEY);
      }
    } catch {
      localStorage.removeItem(UPDATE_KEY);
    }
  }

  // Throttle: only hit the API once per day.
  const lastCheck = localStorage.getItem(LAST_CHECK_KEY);
  if (lastCheck && Date.now() - new Date(lastCheck).getTime() < CHECK_INTERVAL_MS) {
    return;
  }

  const info = await fetchLatestRelease();
  localStorage.setItem(LAST_CHECK_KEY, new Date().toISOString());
  if (!info) return;

  info.isUpToDate = !isNewer(__APP_VERSION__, info.version);
  localStorage.setItem(UPDATE_KEY, JSON.stringify(info));
  onUpdate(info);
}
