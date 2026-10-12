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
  timeoutMs?: number;
}

// Keys are exact Core-facing pathnames (matching Core's real REST paths 1:1), since this
// Worker is called with a request whose pathname already mirrors the upstream Core path --
// see forwardToCoreViaServiceBinding() in web/ops/functions/lib/coreGateway.ts.
export const ALLOWLIST: Record<string, AllowlistRoute> = {
  "/health": { upstreamPath: "/health", allowedQueryParams: [] },
  "/api/fabric/v1/health": { upstreamPath: "/api/fabric/v1/health", allowedQueryParams: [] },
  "/api/fabric/v1/units": { upstreamPath: "/api/fabric/v1/units", allowedQueryParams: [] },
  "/api/fabric/v1/aegis-observation-plan": { upstreamPath: "/api/fabric/v1/aegis-observation-plan", allowedQueryParams: [], methods: ["GET"] },
  "/api/ai/v1/assessment": { upstreamPath: "/api/ai/v1/assessment", allowedQueryParams: [], methods: ["GET"] },
  // Explicit local-model reviews only; this does not expose any paid provider or scheduler.
  "/api/ai/v1/assessment/refresh": { upstreamPath: "/api/ai/v1/assessment/refresh", allowedQueryParams: [], methods: ["POST"], timeoutMs: 90_000 },
  "/api/ai/v1/target-analysis": { upstreamPath: "/api/ai/v1/target-analysis", allowedQueryParams: [], methods: ["POST"], timeoutMs: 90_000 },
  "/api/forecast/v1/chase-setups": { upstreamPath: "/api/forecast/v1/chase-setups", allowedQueryParams: [], methods: ["GET"] },
  "/api/forecast/v1/chase-setup": { upstreamPath: "/api/forecast/v1/chase-setup", allowedQueryParams: ["setup_id"], methods: ["GET"] },
  "/api/storm-intel/v1/health": { upstreamPath: "/api/storm-intel/v1/health", allowedQueryParams: [] },
  "/api/storm-intel/v1/point": {
    upstreamPath: "/api/storm-intel/v1/point",
    allowedQueryParams: ["latitude", "longitude"],
  },
  "/api/weather-alert/v1/settings": { upstreamPath: "/api/weather-alert/v1/settings", allowedQueryParams: [], methods: ["GET", "PUT"] },
  "/api/weather-alert/v1/status": { upstreamPath: "/api/weather-alert/v1/status", allowedQueryParams: [], methods: ["GET"] },
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

// Validate parameterized reads before crossing the private transport boundary.
export function validateQueryParams(route: AllowlistRoute, url: URL): QueryValidationResult {
  if (route.upstreamPath === "/api/forecast/v1/chase-setup") {
    const ids = url.searchParams.getAll("setup_id");
    return ids.length === 1 && /^setup-\d{8}-[a-f0-9]{10}$/.test(ids[0]) ? { ok: true } : { ok: false, reason: "INVALID_SETUP_ID" };
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
