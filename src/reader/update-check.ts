/**
 * Checks GitHub Releases once per day and notifies when a newer version
 * is available. Results are cached in localStorage for 24 hours.
 */

const REPO = "ritz123/LeapReader";
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LAST_CHECK_KEY = "updateCheckAt";
const UPDATE_KEY = "updateAvailable";

export interface UpdateInfo {
  /** Raw tag from GitHub, e.g. "v1.4.0" */
  version: string;
  /** GitHub release page URL */
  url: string;
  /** True when local version >= latest release */
  isUpToDate: boolean;
  /** Set when the fetch failed */
  error?: string;
}

/**
 * Strips the optional leading "v" and compares two semver strings.
 * Returns true only when `remote` is strictly greater than `local`.
 *
 * Examples:
 *   isNewer("1.3.2", "v1.4.0") → true
 *   isNewer("1.3.2", "v1.3.2") → false
 *   isNewer("1.4.0", "v1.3.9") → false
 *
 * Exported for unit testing; not part of the public API.
 */
export function isNewer(local: string, remote: string): boolean {
  const parse = (v: string): number[] => {
    const parts = v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
    // Pad to 3 elements so missing segments (e.g. "1.3") compare as 0.
    while (parts.length < 3) parts.push(0);
    return parts;
  };
  const [lMaj, lMin, lPat] = parse(local);
  const [rMaj, rMin, rPat] = parse(remote);
  if (rMaj !== lMaj) return rMaj > lMaj;
  if (rMin !== lMin) return rMin > lMin;
  return rPat > lPat;
}

async function fetchLatestRelease(): Promise<UpdateInfo> {
  try {
    const res = await fetch(API_URL, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) {
      return { version: "", url: API_URL, isUpToDate: true, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { tag_name?: string; html_url?: string };
    if (!data.tag_name || !data.html_url) {
      return { version: "", url: API_URL, isUpToDate: true, error: "No release found" };
    }
    const isUpToDate = !isNewer(__APP_VERSION__, data.tag_name);
    return { version: data.tag_name, url: data.html_url, isUpToDate };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { version: "", url: API_URL, isUpToDate: true, error };
  }
}

/** Checks for updates (throttled to once per day). Call once after startup. */
export async function checkForUpdate(
  onUpdate: (info: UpdateInfo) => void
): Promise<void> {
  // Re-surface cached result immediately without a network hit.
  const cached = localStorage.getItem(UPDATE_KEY);
  if (cached) {
    try {
      const info = JSON.parse(cached) as UpdateInfo;
      if (info.version && info.url) {
        // Recalculate isUpToDate in case the local version was upgraded.
        info.isUpToDate = !isNewer(__APP_VERSION__, info.version);
        onUpdate(info);
      } else {
        localStorage.removeItem(UPDATE_KEY);
      }
    } catch {
      localStorage.removeItem(UPDATE_KEY);
    }
  }

  // Hit the API at most once per day.
  const lastCheck = localStorage.getItem(LAST_CHECK_KEY);
  if (lastCheck && Date.now() - new Date(lastCheck).getTime() < CHECK_INTERVAL_MS) {
    return;
  }

  const info = await fetchLatestRelease();
  localStorage.setItem(LAST_CHECK_KEY, new Date().toISOString());

  if (!info.error) {
    localStorage.setItem(UPDATE_KEY, JSON.stringify(info));
  }

  onUpdate(info);
}
