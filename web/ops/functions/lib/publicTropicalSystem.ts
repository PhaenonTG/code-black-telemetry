/** One NHC-ID-scoped storm feed. No Grand Bay watch data crosses this boundary. */
import { forwardToCore, type GatewayEnv } from "./coreGateway";

export const PUBLIC_TROPICAL_SYSTEMS_PREFIX = "/api/public/tropical-systems/";
const ID = /^(?:al|ep|cp)\d{6}$/;
const CORE_ROUTE = { upstreamPath: "/api/forecast/v1/tropical-system", allowedQueryParams: ["storm_id"] };
const ORIGINS = new Set(["https://tropics.codeblackwx.com", "https://codeblack-hurricane.pages.dev"]);
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const rows = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown, max = 160): string | null => typeof value === "string" ? value.slice(0, max) : null;
const time = (value: unknown): string | null => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value.slice(0, 40) : null;
const number = (value: unknown, min: number, max: number): number | null => {
  const parsed = typeof value === "number" || typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
};
const official = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "www.nhc.noaa.gov" ? url.toString() : null; }
  catch { return null; }
};
const point = (value: unknown) => {
  const row = object(value);
  const latitude = number(row.latitude, -90, 90), longitude = number(row.longitude, -180, 180);
  return latitude == null || longitude == null ? null : { latitude, longitude, valid_time: time(row.valid_time ?? row.at),
    hour: number(row.hour, 0, 120), wind_mph: number(row.wind_mph, 0, 250), pressure_mb: number(row.pressure_mb, 800, 1100) };
};
const points = (value: unknown, limit: number) => rows(value).slice(0, limit).map(point).filter((item) => item !== null);
const statements = (value: unknown, limit: number, max = 240) => rows(value).slice(0, limit).map((item) => text(item, max)).filter((item): item is string => Boolean(item));
const publicAnalysis = (value: unknown, fingerprint: unknown, freshness: unknown, stormId: string) => {
  const review = object(value);
  if (freshness !== "current") return { status: "stale" as const };
  if (review.storm_id !== stormId) return { status: "pending" as const };
  if (review.status === "withheld" && review.source_fingerprint === fingerprint)
    return { status: "withheld" as const };
  if (review.status !== "ready" || review.source_fingerprint !== fingerprint || !time(review.reviewed_at))
    return { status: review.status === "unavailable" ? "unavailable" as const : "pending" as const };
  const sources = new Set(["nhc_status", "nhc_discussion", "nhc_track", "nhc_best_track", "nhc_model_aids"]);
  return { status: "ready" as const, model: text(review.model, 40), reviewed_at: time(review.reviewed_at),
    basis_nhc_updated_at: time(review.basis_nhc_updated_at), confidence: ["low", "moderate", "high"].includes(String(review.confidence)) ? review.confidence : "low",
    summary: text(review.summary, 1100), track_assessment: text(review.track_assessment, 520), intensity_assessment: text(review.intensity_assessment, 520),
    changes: statements(review.changes, 4), uncertainties: statements(review.uncertainties, 4), next_check: statements(review.next_check, 4),
    evidence: rows(review.evidence).slice(0, 5).map((item) => { const row = object(item); return { source: row.source, finding: text(row.finding, 240) }; })
      .filter((item) => sources.has(String(item.source)) && item.finding) };
};
const priorReviews = (value: unknown, stormId: string, currentFingerprint: unknown) => rows(value).slice(0, 5).flatMap((item) => {
  const review = object(item);
  if (typeof review.source_fingerprint !== "string" || !review.source_fingerprint || review.source_fingerprint === currentFingerprint) return [];
  const safe = publicAnalysis(review, review.source_fingerprint, "current", stormId);
  return safe.status === "ready" ? [safe] : [];
});

export function toPublicTropicalSystem(input: unknown) {
  const source = object(input), stormId = text(source.storm_id, 16);
  if (!ID.test(stormId ?? "")) return { status: "unavailable" as const };
  if (source.status === "pending") return { status: "pending" as const, storm_id: stormId };
  const rawGuidance = object(source.guidance), rawProjection = object(source.projection), urls = object(source.sources);
  const center = object(source.current_center);
  return {
    schema: "codeblack.tropics.public-system.v1", status: source.status === "active" ? "active" : "historical",
    freshness: source.freshness === "current" ? "current" : "stale", storm_id: stormId,
    name: text(source.name, 80), classification: text(source.classification, 16), basin: text(source.basin, 30),
    checked_at: time(source.checked_at), nhc_updated_at: time(source.nhc_updated_at),
    wind_kt: number(source.wind_kt, 0, 200), pressure_mb: number(source.pressure_mb, 800, 1100),
    current_center: { latitude: number(center.latitude, -90, 90), longitude: number(center.longitude, -180, 180) },
    track: points(source.track, 40), track_issued_at: time(source.track_issued_at),
    observed_track: points(source.observed_track, 160),
    reported_centers: points(source.reported_centers, 200),
    guidance: { status: rawGuidance.status === "ready" ? "ready" : "unavailable",
      latest_cycle: time(rawGuidance.latest_cycle),
      models: rows(rawGuidance.models).slice(0, 16).map((item) => { const model = object(item); return {
        id: text(model.id, 8), name: text(model.name, 50), cycle: time(model.cycle), points: points(model.points, 25),
      }; }).filter((model) => model.id && model.points.length) },
    projection: { status: rawProjection.status === "ready" ? "ready" : "unavailable",
      method: text(rawProjection.method, 300), cycle: time(rawProjection.cycle),
      member_ids: rows(rawProjection.member_ids).slice(0, 16).map((id) => text(id, 8)).filter(Boolean),
      points: points(rawProjection.points, 30) },
    analysis: publicAnalysis(source.analysis, source.source_fingerprint, source.freshness, stormId),
    prior_reviews: priorReviews(source.prior_reviews, stormId, source.source_fingerprint),
    sources: { advisory: official(urls.advisory), discussion: official(urls.discussion), status: official(urls.status),
      track: official(urls.track) },
  };
}

export async function handlePublicTropicalSystem(request: Request, env: GatewayEnv, ctx?: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
  const origin = request.headers.get("Origin");
  const cors = origin && ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET, OPTIONS" } });
  if (request.method !== "GET") return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: { "Content-Type": "application/json", ...cors } });
  const url = new URL(request.url);
  const stormId = url.pathname.slice(PUBLIC_TROPICAL_SYSTEMS_PREFIX.length).toLowerCase();
  if (!ID.test(stormId) || url.pathname !== `${PUBLIC_TROPICAL_SYSTEMS_PREFIX}${stormId}`)
    return new Response(JSON.stringify({ error: "UNKNOWN_STORM_ID" }), { status: 404, headers: { "Content-Type": "application/json", ...cors } });
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(`https://ops.codeblackwx.com${PUBLIC_TROPICAL_SYSTEMS_PREFIX}${stormId}`);
  const cached = cache ? await cache.match(cacheKey) : null;
  if (cached) return new Response(cached.body, { status: 200, headers: { ...Object.fromEntries(cached.headers), ...cors } });
  const upstream = new URL("https://ops.codeblackwx.com/api/forecast/v1/tropical-system");
  upstream.searchParams.set("storm_id", stormId);
  const result = await forwardToCore(CORE_ROUTE, upstream, env);
  if (result.status !== 200) return new Response(JSON.stringify({ error: "DATA_UNAVAILABLE" }), { status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors } });
  const safe = new Response(JSON.stringify(toPublicTropicalSystem(result.body)), { status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=30, s-maxage=60", "X-Content-Type-Options": "nosniff" } });
  if (cache) ctx?.waitUntil(cache.put(cacheKey, safe.clone()));
  return new Response(safe.body, { status: 200, headers: { ...Object.fromEntries(safe.headers), ...cors } });
}
