/**
 * Checks GitHub Releases once per day for a newer version and surfaces a
 * banner in the About dialog + a one-time toast notification.
 *
 * Throttle key: "updateCheckAt" — ISO timestamp of last successful check.
 * Result key:   "updateAvailable" — JSON { version, url } or absent.
 */

const REPO = "ritz123/LeapReader";
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const LAST_CHECK_KEY = "updateCheckAt";
const UPDATE_KEY = "updateAvailable";

export interface UpdateInfo {
  version: string;
  url: string;
  isUpToDate: boolean;
  error?: string;
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
  console.log(`[update-check] fetching ${API_URL}`);
  try {
    const res = await fetch(API_URL, { headers: { Accept: "application/vnd.github+json" } });
    console.log(`[update-check] response status: ${res.status}`);
    if (!res.ok) {
      console.warn(`[update-check] fetch failed: HTTP ${res.status}`);
      return { version: "", url: API_URL, isUpToDate: false, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { tag_name?: string; html_url?: string };
    console.log(`[update-check] tag_name=${data.tag_name}  html_url=${data.html_url}`);
    if (!data.tag_name || !data.html_url) {
      return { version: "", url: API_URL, isUpToDate: false, error: "No release found" };
    }
    return { version: data.tag_name, url: data.html_url, isUpToDate: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[update-check] fetch error: ${msg}`);
    return { version: "", url: API_URL, isUpToDate: false, error: msg };
  }
}

/** Runs the update check (throttled). Call once after startup. */
export async function checkForUpdate(
  onUpdate: (info: UpdateInfo) => void
): Promise<void> {
  console.log(`[update-check] local=${__APP_VERSION__}`);

  // Re-surface cached latest version without a network hit.
  const cached = localStorage.getItem(UPDATE_KEY);
  if (cached) {
    try {
      const info = JSON.parse(cached) as UpdateInfo;
      if (info.version && info.url) {
        info.isUpToDate = !isNewer(__APP_VERSION__, info.version);
        console.log(`[update-check] using cache: version=${info.version} isUpToDate=${info.isUpToDate}`);
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
    console.log(`[update-check] throttled — last check: ${lastCheck}`);
    return;
  }

  const info = await fetchLatestRelease();
  localStorage.setItem(LAST_CHECK_KEY, new Date().toISOString());
  if (!info) return;

  if (info.error) {
    onUpdate(info);
    return;
  }

  info.isUpToDate = !isNewer(__APP_VERSION__, info.version);
  localStorage.setItem(UPDATE_KEY, JSON.stringify(info));
  onUpdate(info);
}
