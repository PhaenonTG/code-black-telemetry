// Platform boundary for GPS position. The browser implementation below uses
// the standard Geolocation API directly; a future Capacitor native shell can
// swap in @capacitor/geolocation (which itself falls back to this same
// browser API when not running natively, so behavior stays consistent).

export type LocationState =
  | { status: "unavailable" }
  | { status: "denied" }
  | { status: "requesting" }
  | { status: "ready"; lat: number; lon: number; accuracyM: number; headingDeg: number | null; speedMph: number | null; at: number };

export interface LocationAdapter {
  getCurrent(): Promise<LocationState>;
  watch(onUpdate: (state: LocationState) => void): () => void;
}

function fromPosition(pos: GeolocationPosition): LocationState {
  return {
    status: "ready",
    lat: pos.coords.latitude,
    lon: pos.coords.longitude,
    accuracyM: pos.coords.accuracy,
    headingDeg: pos.coords.heading,
    speedMph: pos.coords.speed != null ? pos.coords.speed * 2.23694 : null,
    at: pos.timestamp,
  };
}

// Local dev/QA convenience: set VITE_DEV_FIXED_LOCATION="lat,lon" in web/ops/.env to bypass the
// browser's real geolocation prompt entirely -- useful when testing on a plain dev-server tab that
// has no way to grant a location permission (sandboxed preview browsers, headless test runners).
// Never set in a real deployment's environment, so production behavior is untouched.
function devFixedLocation(): LocationState | null {
  const raw = (import.meta.env.VITE_DEV_FIXED_LOCATION as string | undefined)?.trim();
  if (!raw) return null;
  const [latStr, lonStr] = raw.split(",").map((part) => part.trim());
  const lat = Number(latStr);
  const lon = Number(lonStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { status: "ready", lat, lon, accuracyM: 15, headingDeg: null, speedMph: null, at: Date.now() };
}

export const browserLocationAdapter: LocationAdapter = {
  async getCurrent() {
    const fixed = devFixedLocation();
    if (fixed) return fixed;
    if (typeof navigator === "undefined" || !navigator.geolocation) return { status: "unavailable" };
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(fromPosition(pos)),
        (err) => resolve(err.code === err.PERMISSION_DENIED ? { status: "denied" } : { status: "unavailable" }),
        { enableHighAccuracy: true, timeout: 10_000 },
      );
    });
  },
  watch(onUpdate) {
    const fixed = devFixedLocation();
    if (fixed) {
      onUpdate(fixed);
      return () => {};
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      onUpdate({ status: "unavailable" });
      return () => {};
    }
    // Single subscription, not a retry loop -- a denial fires once and stays denied until the
    // user changes the browser's own site permission; polling would just re-prompt/re-deny forever.
    const id = navigator.geolocation.watchPosition(
      (pos) => onUpdate(fromPosition(pos)),
      (err) => onUpdate(err.code === err.PERMISSION_DENIED ? { status: "denied" } : { status: "unavailable" }),
      { enableHighAccuracy: true },
    );
    return () => navigator.geolocation.clearWatch(id);
  },
};
