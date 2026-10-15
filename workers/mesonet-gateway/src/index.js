const CORE_ORIGIN = "http://127.0.0.1:8000";
const BASE = "/api/chase/mesonet/";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

function dedicated(response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-CodeBlack-Mesonet-Gateway", "dedicated-v1");
  return new Response(response.body, { status: response.status, headers });
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(BASE)) return dedicated(json(404, { error: "NOT_FOUND" }));
  if (!env.CORE_VPC) return dedicated(json(503, { error: "CORE_UNAVAILABLE" }));

  const path = url.pathname.slice(BASE.length);
  if (path === "ingest") {
    if (request.method !== "POST") return dedicated(json(405, { error: "METHOD_NOT_ALLOWED" }));
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return dedicated(json(401, { error: "AUTH_REQUIRED" }));
    const length = Number(request.headers.get("Content-Length") || "0");
    if (length > 4096) return dedicated(json(413, { error: "PAYLOAD_TOO_LARGE" }));
    const body = await request.arrayBuffer();
    if (body.byteLength > 4096) return dedicated(json(413, { error: "PAYLOAD_TOO_LARGE" }));
    try {
      const response = await env.CORE_VPC.fetch(`${CORE_ORIGIN}/api/mesonet/v1/ingest`, {
        method: "POST", body,
        headers: { Authorization: authorization, "Content-Type": "application/json" },
      });
      return dedicated(response);
    } catch { return dedicated(json(502, { error: "CORE_TRANSPORT_UNAVAILABLE" })); }
  }

  if (path === "ota/check" || /^ota\/image\/(wind|weather|striker-weather|striker-nav)\/\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(path)) {
    if (request.method !== "GET") return dedicated(json(405, { error: "METHOD_NOT_ALLOWED" }));
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return dedicated(json(401, { error: "AUTH_REQUIRED" }));
    try {
      const response = await env.CORE_VPC.fetch(`${CORE_ORIGIN}/api/mesonet/v1/${path}${url.search}`, {
        headers: { Authorization: authorization },
      });
      return dedicated(response);
    } catch { return dedicated(json(502, { error: "CORE_TRANSPORT_UNAVAILABLE" })); }
  }

  if (path === "public") {
    if (request.method === "OPTIONS") return dedicated(new Response(null, { status: 204, headers: CORS }));
    if (request.method !== "GET") return dedicated(json(405, { error: "METHOD_NOT_ALLOWED" }));
    if (!env.MESONET_READ_TOKEN) return dedicated(json(503, { error: "NOT_CONFIGURED" }));
    try {
      const upstream = await env.CORE_VPC.fetch(`${CORE_ORIGIN}/api/mesonet/v1/latest`, {
        headers: { Authorization: `Bearer ${env.MESONET_READ_TOKEN}` },
      });
      if (!upstream.ok) return dedicated(json(503, { error: "READINGS_UNAVAILABLE" }));
      const state = await upstream.json();
      const wind = state.wind?.readings ?? {}, weather = state.weather?.readings ?? {};
      return dedicated(json(200, {
        temperature_c: weather.temperature_c ?? null,
        humidity_pct: weather.humidity_pct ?? null,
        dewpoint_c: weather.dewpoint_c ?? null,
        wind_mps: state.wind?.calibration_verified ? wind.wind_mps ?? null : null,
        wind_avg_mps: state.wind?.calibration_verified ? wind.wind_avg_mps ?? null : null,
        gust_mps: state.wind?.calibration_verified ? wind.gust_mps ?? null : null,
        wind_calibration_verified: state.wind?.calibration_verified === true,
        wind_reference: "apparent", generated_at: new Date().toISOString(),
      }, CORS));
    } catch { return dedicated(json(502, { error: "CORE_TRANSPORT_UNAVAILABLE" })); }
  }
  return dedicated(json(404, { error: "NOT_FOUND" }));
}

export default { fetch: handleRequest };
