// Coarse, city-level fallback location for when live device GPS is denied or unavailable (a
// workstation browser with no location permission granted, or an environment geolocation just
// doesn't work in). This is deliberately NOT a GPS substitute -- it's only precise to roughly a
// city, sourced from the visitor's IP address via a public, unauthenticated, CORS-enabled API
// (ipapi.co, no key required at this call volume) -- but it beats leaving Point Inspector empty
// and forcing a manual map tap on every cold load just because the device won't share real GPS.
//
// Cached in localStorage rather than re-fetched every load: the free API has a daily rate limit,
// and a workstation's rough location rarely changes between sessions, so there's no benefit to
// re-querying more than a few times a day.

export interface IpLocation {
  lat: number;
  lon: number;
}

const CACHE_KEY = "codeblack.ops.ipLocationCache";
const CACHE_MAX_AGE_MS = 6 * 60 * 60_000;
const FETCH_TIMEOUT_MS = 5_000;

interface CacheEntry {
  lat: number;
  lon: number;
  at: number;
}

function readCache(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CacheEntry>;
    if (typeof parsed.lat !== "number" || typeof parsed.lon !== "number" || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > CACHE_MAX_AGE_MS) return null;
    return parsed as CacheEntry;
  } catch {
    return null;
  }
}

function writeCache(entry: CacheEntry): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Storage unavailable/full -- non-fatal, just means the next load re-fetches.
  }
}

export const ipLocationAdapter = {
  async getApprox(): Promise<IpLocation | null> {
    const cached = readCache();
    if (cached) return { lat: cached.lat, lon: cached.lon };
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch("https://ipapi.co/json/", { signal: controller.signal, headers: { Accept: "application/json" } });
      if (!response.ok) return null;
      const json = (await response.json()) as { latitude?: unknown; longitude?: unknown; error?: unknown };
      const lat = Number(json.latitude);
      const lon = Number(json.longitude);
      if (json.error || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      writeCache({ lat, lon, at: Date.now() });
      return { lat, lon };
    } catch {
      return null;
    } finally {
      window.clearTimeout(timer);
    }
  },
};
