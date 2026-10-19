// Pure, dependency-free helpers for the standalone Core Gateway VPC transport Worker's
// allowlist. Framework-free so it can be unit tested directly with Vitest under Node.
//
// This is a SECOND, independent allowlist -- defense in depth. The Pages gateway
// (web/ops/functions/lib/coreGateway.ts) already allowlists routes before it ever calls this
// Worker; this Worker does not trust that and re-validates from scratch. There is no
// passthrough, no wildcard, and no caller-controlled path or host.

export interface AllowlistRoute {
  upstreamPath: string;
  allowedQueryParams: string[];
  methods?: readonly string[];
  opsWrite?: "review" | "decision";
  opsSignedRead?: "review" | "decision";
}

// Keys are exact Core-facing pathnames (matching Core's real REST paths 1:1), since this
// Worker is called with a request whose pathname already mirrors the upstream Core path --
// see forwardToCoreViaServiceBinding() in web/ops/functions/lib/coreGateway.ts.
export const ALLOWLIST: Record<string, AllowlistRoute> = {
  "/api/ops/directory/v1/snapshot": { upstreamPath: "/api/ops/directory/v1/snapshot", allowedQueryParams: [], opsSignedRead: "review" },
  "/api/ops/status-center/v1/inventory": { upstreamPath: "/api/ops/status-center/v1/inventory", allowedQueryParams: [], opsSignedRead: "decision" },
  "/api/forecast/v1/targets": { upstreamPath: "/api/forecast/v1/targets", allowedQueryParams: ["latitude", "longitude", "radius_miles"] },
  "/api/forecast/v1/review": { upstreamPath: "/api/forecast/v1/review", allowedQueryParams: ["run", "forecast_hour", "candidate_index"] },
  "/api/forecast/v1/runs": { upstreamPath: "/api/forecast/v1/runs", allowedQueryParams: [] },
  "/api/forecast/v1/point": { upstreamPath: "/api/forecast/v1/point", allowedQueryParams: ["latitude", "longitude", "run"] },
  "/api/forecast/v1/alerts": { upstreamPath: "/api/forecast/v1/alerts", allowedQueryParams: ["latitude", "longitude"] },
  "/api/forecast/v1/briefings": { upstreamPath: "/api/forecast/v1/briefings", allowedQueryParams: [] },
  "/api/forecast/v1/verified-events": { upstreamPath: "/api/forecast/v1/verified-events", allowedQueryParams: ["latitude", "longitude", "radius_miles", "year"] },
  "/api/forecast/v1/hurricane-watch": { upstreamPath: "/api/forecast/v1/hurricane-watch", allowedQueryParams: [] },
  "/api/forecast/v1/chase-setups": { upstreamPath: "/api/forecast/v1/chase-setups", allowedQueryParams: [] },
  "/api/forecast/v1/chase-horizons": { upstreamPath: "/api/forecast/v1/chase-horizons", allowedQueryParams: [], opsSignedRead: "review" },
  "/api/forecast/v1/tornado-potential": { upstreamPath: "/api/forecast/v1/tornado-potential", allowedQueryParams: ["frame"] },
  "/api/forecast/v1/chase-setup": { upstreamPath: "/api/forecast/v1/chase-setup", allowedQueryParams: ["setup_id", "revision"] },
  "/api/forecast/v1/chase-setup-review": { upstreamPath: "/api/forecast/v1/chase-setup-review", allowedQueryParams: [], methods: ["POST"], opsWrite: "review" },
  "/api/forecast/v1/chase-setup-decision": { upstreamPath: "/api/forecast/v1/chase-setup-decision", allowedQueryParams: [], methods: ["POST"], opsWrite: "decision" },
  "/api/forecast/v1/chase-setup-policy": { upstreamPath: "/api/forecast/v1/chase-setup-policy", allowedQueryParams: [], methods: ["POST"], opsWrite: "decision" },
  "/api/forecast/v1/chase-setup-paid-review": { upstreamPath: "/api/forecast/v1/chase-setup-paid-review", allowedQueryParams: [], methods: ["POST"], opsWrite: "decision" },
  "/health": { upstreamPath: "/health", allowedQueryParams: [] },
  "/api/fabric/v1/health": { upstreamPath: "/api/fabric/v1/health", allowedQueryParams: [] },
  "/api/fabric/v1/units": { upstreamPath: "/api/fabric/v1/units", allowedQueryParams: [] },
  "/api/fabric/v1/aegis-status": { upstreamPath: "/api/fabric/v1/aegis-status", allowedQueryParams: [], methods: ["GET"] },
  "/api/fabric/v1/aegis-alerts": { upstreamPath: "/api/fabric/v1/aegis-alerts", allowedQueryParams: ["after", "limit"], methods: ["GET"] },
  "/api/fabric/v1/aegis-observation-plan": { upstreamPath: "/api/fabric/v1/aegis-observation-plan", allowedQueryParams: [], methods: ["GET"] },
  "/api/fabric/v1/aegis-policy": { upstreamPath: "/api/fabric/v1/aegis-policy", allowedQueryParams: [], methods: ["GET"] },
  "/api/fabric/v1/aegis-policy/replay": { upstreamPath: "/api/fabric/v1/aegis-policy/replay", allowedQueryParams: [], methods: ["POST"] },
  "/api/fabric/v1/stream": { upstreamPath: "/api/fabric/v1/stream", allowedQueryParams: [] },
  "/api/storm-intel/v1/health": { upstreamPath: "/api/storm-intel/v1/health", allowedQueryParams: [] },
  "/api/storm-intel/v1/point": {
    upstreamPath: "/api/storm-intel/v1/point",
    allowedQueryParams: ["latitude", "longitude"],
  },
  "/api/soundings/v1/health": { upstreamPath: "/api/soundings/v1/health", allowedQueryParams: [] },
  "/api/soundings/v1/point": {
    upstreamPath: "/api/soundings/v1/point",
    allowedQueryParams: ["latitude", "longitude", "model", "location_name"],
  },
  "/api/soundings/v1/search-location": {
    upstreamPath: "/api/soundings/v1/search-location",
    allowedQueryParams: ["city", "state"],
  },
  "/api/weather-alert/v1/settings": { upstreamPath: "/api/weather-alert/v1/settings", allowedQueryParams: [], methods: ["GET", "PUT"] },
  "/api/weather-alert/v1/status": { upstreamPath: "/api/weather-alert/v1/status", allowedQueryParams: [], methods: ["GET"] },
  "/api/ops/status-center/v1/status": { upstreamPath: "/api/ops/status-center/v1/status", allowedQueryParams: [] },
  "/api/ops/status-center/v1/radar-control-settings": {
    upstreamPath: "/api/ops/status-center/v1/radar-control-settings",
    allowedQueryParams: [],
    methods: ["GET", "PUT"],
  },
};

export function resolveRoute(pathname: string): AllowlistRoute | null {
  return ALLOWLIST[pathname] ?? null;
}

export type QueryValidationResult = { ok: true } | { ok: false; reason: string };

const LATITUDE_MIN = -90;
const LATITUDE_MAX = 90;
const LONGITUDE_MIN = -180;
const LONGITUDE_MAX = 180;

function parseFiniteNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Validates the query parameters for a resolved route. Currently only Storm Intel's point
// lookup takes query parameters; every other route in ALLOWLIST has none, so this always
// passes for them. Kept generic (keyed on upstreamPath) so a future parameterized route does
// not silently skip validation.
export function validateQueryParams(route: AllowlistRoute, url: URL): QueryValidationResult {
  if (route.upstreamPath === "/api/forecast/v1/tornado-potential") {
    const frame = url.searchParams.get("frame");
    return frame === null || /^\d{10}-f\d{2}$/.test(frame) ? { ok: true } : { ok: false, reason: "INVALID_FRAME" };
  }
  if (route.upstreamPath === "/api/forecast/v1/chase-setup") {
    if (!/^setup-\d{8}-[0-9a-f]{10}$/.test(url.searchParams.get("setup_id") ?? "")) {
      return { ok: false, reason: "INVALID_SETUP_ID" };
    }
    const revision = url.searchParams.get("revision");
    return revision === null || /^[1-9]\d{0,8}$/.test(revision)
      ? { ok: true } : { ok: false, reason: "INVALID_REVISION" };
  }
  if (route.upstreamPath !== "/api/storm-intel/v1/point") return { ok: true };

  const latitude = parseFiniteNumber(url.searchParams.get("latitude"));
  if (latitude === null || latitude < LATITUDE_MIN || latitude > LATITUDE_MAX) {
    return { ok: false, reason: "INVALID_LATITUDE" };
  }

  const longitude = parseFiniteNumber(url.searchParams.get("longitude"));
  if (longitude === null || longitude < LONGITUDE_MIN || longitude > LONGITUDE_MAX) {
    return { ok: false, reason: "INVALID_LONGITUDE" };
  }

  return { ok: true };
}

// Fixed, hardcoded conceptually to Core's private origin. Never derived from the incoming
// request -- this is what prevents this Worker from becoming an open proxy even if VPC
// Network (rather than VPC Service) routing is used in the future, where the fetch() target
// URL does determine the destination.
export const CORE_ORIGIN = "http://127.0.0.1:8000";

// Builds the exact URL this Worker will ask the VPC binding to fetch: the fixed Core origin,
// the allowlisted upstream path, and only the allowlisted query params carried over from the
// caller's request -- nothing else from the incoming URL (host, other params, etc.) survives.
export function buildCoreUrl(route: AllowlistRoute, incomingUrl: URL): string {
  const target = new URL(route.upstreamPath, CORE_ORIGIN);
  for (const key of route.allowedQueryParams) {
    const value = incomingUrl.searchParams.get(key);
    if (value !== null) target.searchParams.set(key, value);
  }
  return target.toString();
}
