// Public (no Supabase OPS session) relay for the Storm Intel v1 REST route a broadcast overlay
// needs. Mirrors ardotCameraRelay.ts's pattern -- a plain importable module wired directly into
// worker/entry.ts's own fetch handler (Advanced Mode never routes to functions/api/*.ts
// folder-convention Functions; see the comment atop worker/entry.ts).
//
// Why this exists instead of just using /api/core/*: that gateway requires a signed-in OPS
// user's Supabase session (verifyOpsAuth), which a headless OBS browser source has no way to
// obtain -- there's no login UI running in a stream overlay. This relay is deliberately narrower
// in what it exposes to make going auth-free safe:
//   - Only the point (lat/lon) Storm Intel context, never a unit-context route. A unit's fleet
//     ID (cbwx-unit-*) is never accepted as input here and never appears in any response --
//     matching the existing "Public Overlay Boundary" the overlay's own publicIdentity.ts
//     already enforces client-side. This relay enforces the same boundary server-side, which is
//     the boundary that actually matters.
//   - Only two fixed upstream paths (health/point), same hardcoded-allowlist shape as
//     CORE_GATEWAY_ALLOWLIST -- no passthrough, no caller-controlled upstream path.
//   - Reuses forwardToCore() itself (not a reimplementation) so this always uses whatever
//     transport is actually configured in production -- confirmed live that this account's
//     production only works via the CORE_GATEWAY_WORKER VPC Service Binding path; the
//     alternate "public fetch + CF-Access headers" branch forwardToCore also supports hits an
//     Access sign-in page instead of Core (that public tunnel hostname's Access policy no
//     longer honors the configured service-token headers, or was never meant to be reached
//     this way). Reusing forwardToCore means this relay automatically tracks whichever
//     transport is really live instead of guessing.
//
// No WebSocket relay yet: the VPC Service Binding Worker (workers/core-gateway/) only proxies
// the REST allowlist above, not a WS upgrade, and the public Access-tunnel path doesn't work at
// all right now (see above) -- so there is no live transport to relay a WS connection through
// today. web/overlay's RestStormIntelProvider was changed to poll this REST route on an
// interval instead of depending on WS for ongoing updates, so this gap doesn't leave the
// overlay stuck re-showing "connection lost" over real data. Revisit once/if a VPC-reachable WS
// transport exists.
import { forwardToCore, type GatewayEnv } from "./coreGateway";
import { normalizeStormIntelSnapshot } from "../../../overlay/src/stormIntel/normalize";

export const OVERLAY_CORE_PREFIX = "/overlay-core";

const REST_ROUTES: Record<string, { upstreamPath: string; allowedQueryParams: string[] }> = {
  "/api/storm-intel/v1/health": { upstreamPath: "/api/storm-intel/v1/health", allowedQueryParams: [] },
  "/api/storm-intel/v1/point": { upstreamPath: "/api/storm-intel/v1/point", allowedQueryParams: ["latitude", "longitude"] },
};

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function toPublicStormIntelPoint(body: unknown): object {
  const snapshot = normalizeStormIntelSnapshot(body);
  if (snapshot.context.contextType !== "SELECTED_TARGET") throw new Error("Unexpected Storm Intel context");
  return {
    schema: snapshot.schema,
    provider_name: snapshot.providerName,
    generated_at: snapshot.generatedAt,
    simulation: snapshot.simulation,
    available: snapshot.available,
    unavailable_reason: snapshot.unavailableReason,
    context: {
      context_type: "SELECTED_TARGET",
      requested_at: snapshot.context.requestedAt,
      location: {
        available: snapshot.context.location.available,
        latitude: snapshot.context.location.latitude,
        longitude: snapshot.context.location.longitude,
        resolved_from: "explicit_target",
        unit_id: null,
        unit_position_observed_at: null,
        unit_position_health_state: null,
        heading_deg: null,
        distance_miles: null,
        unavailable_reason: snapshot.context.location.unavailableReason,
      },
    },
    metrics: snapshot.metrics.map((metric) => ({
      key: metric.key, label: metric.label, value: metric.value, unit: metric.unit,
      source: metric.source && {
        provider: metric.source.provider, product: metric.source.product,
        run_time: metric.source.runTime, valid_time: metric.source.validTime,
        formulation: metric.source.formulation, forecast_hour: metric.source.forecastHour,
        data_class: metric.source.dataClass,
        resolved_latitude: metric.source.resolvedLatitude,
        resolved_longitude: metric.source.resolvedLongitude,
        grid_distance_km: metric.source.gridDistanceKm,
      },
      retrieved_at: metric.retrievedAt, age_seconds: metric.ageSeconds,
      freshness: metric.freshness, quality: metric.quality,
      availability: metric.availability, unavailable_reason: metric.unavailableReason,
      trend: metric.trend && { direction: metric.trend.direction, delta: metric.trend.delta, period_minutes: metric.trend.periodMinutes },
      derivation: metric.derivation,
    })),
    score: {
      available: snapshot.score.available, value: snapshot.score.value, label: snapshot.score.label,
      algorithm_id: snapshot.score.algorithmId, algorithm_version: snapshot.score.algorithmVersion,
      inputs_used: snapshot.score.inputsUsed, unavailable_reason: snapshot.score.unavailableReason,
    },
    canonical_units: snapshot.canonicalUnits,
  };
}

export function validPoint(url: URL): boolean {
  const latText = url.searchParams.get("latitude");
  const lonText = url.searchParams.get("longitude");
  if (!latText || !lonText || !/^-?\d{1,3}(?:\.\d{1,6})?$/.test(latText) || !/^-?\d{1,3}(?:\.\d{1,6})?$/.test(lonText)) return false;
  const lat = Number(latText);
  const lon = Number(lonText);
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

export async function handlePublicStormIntelRequest(request: Request, env: GatewayEnv, ctx?: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
  const url = new URL(request.url);
  const routePath = url.pathname.slice(OVERLAY_CORE_PREFIX.length);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const restRoute = REST_ROUTES[routePath];
  if (!restRoute) {
    return new Response(JSON.stringify({ error: "ROUTE_NOT_ALLOWED" }), {
      status: 404,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS_HEADERS },
    });
  }
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), {
      status: 405,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS_HEADERS },
    });
  }

  if (routePath === "/api/storm-intel/v1/point" && !validPoint(url)) {
    return new Response(JSON.stringify({ error: "INVALID_POINT" }), { status: 400,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS_HEADERS } });
  }

  const cache = routePath === "/api/storm-intel/v1/point" && typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = cache ? new Request(`https://ops.codeblackwx.com${url.pathname}?${url.searchParams.toString()}`) : null;
  const cached = cache && cacheKey ? await cache.match(cacheKey) : null;
  if (cached) return new Response(cached.body, { status: cached.status, headers: { ...Object.fromEntries(cached.headers), ...CORS_HEADERS } });

  const result = await forwardToCore(restRoute, url, env);
  if (result.status !== 200) return new Response(JSON.stringify({ error: result.reason ?? "CORE_UNAVAILABLE" }), {
    status: result.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS_HEADERS },
  });
  let body: object = result.body as object;
  if (routePath === "/api/storm-intel/v1/point") {
    try { body = toPublicStormIntelPoint(result.body); }
    catch { return new Response(JSON.stringify({ error: "INVALID_CORE_RESPONSE" }), { status: 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS_HEADERS } }); }
  }
  const safe = new Response(JSON.stringify(body), { status: 200, headers: {
    "Content-Type": "application/json", "Cache-Control": cache ? "public, max-age=20, s-maxage=20" : "no-store",
    "X-Content-Type-Options": "nosniff", ...CORS_HEADERS,
  } });
  if (cache && cacheKey && ctx) ctx.waitUntil(cache.put(cacheKey, safe.clone()));
  return safe;
}
