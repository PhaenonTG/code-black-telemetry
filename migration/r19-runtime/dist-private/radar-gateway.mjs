// private-ops-radar-integration/web/ops/scripts/private-auth.ts
import { createHash } from "node:crypto";

// private-ops-radar-integration/web/ops/functions/lib/coreGateway.ts
async function verifyOpsAuth(authorizationHeader, env, fetchImpl = fetch) {
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    return { ok: false, status: 401, reason: "AUTH_REQUIRED" };
  }
  const token = authorizationHeader.slice("Bearer ".length).trim();
  if (!token) return { ok: false, status: 401, reason: "AUTH_REQUIRED" };
  const supabaseUrl = env.VITE_SUPABASE_URL;
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) {
    return { ok: false, status: 500, reason: "GATEWAY_MISCONFIGURED" };
  }
  let userResponse;
  try {
    userResponse = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: publishableKey }
    });
  } catch {
    return { ok: false, status: 502, reason: "AUTH_PROVIDER_UNAVAILABLE" };
  }
  if (!userResponse.ok) return { ok: false, status: 401, reason: "AUTH_INVALID" };
  const user = await userResponse.json().catch(() => null);
  const userId = user?.id;
  if (!userId) return { ok: false, status: 401, reason: "AUTH_INVALID" };
  let profileResponse;
  try {
    profileResponse = await fetchImpl(
      `${supabaseUrl}/rest/v1/profiles?select=active,role&user_id=eq.${encodeURIComponent(userId)}`,
      { headers: { Authorization: `Bearer ${token}`, apikey: publishableKey } }
    );
  } catch {
    return { ok: false, status: 502, reason: "AUTH_PROVIDER_UNAVAILABLE" };
  }
  if (!profileResponse.ok) return { ok: false, status: 403, reason: "UNAUTHORIZED" };
  const rows = await profileResponse.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length === 0 || rows[0].active !== true) {
    return { ok: false, status: 403, reason: "UNAUTHORIZED" };
  }
  return { ok: true, userId, role: ["OWNER", "ADMIN", "OPERATOR"].includes(rows[0].role ?? "") ? rows[0].role : null };
}

// private-ops-radar-integration/web/ops/scripts/private-auth.ts
var AUTH_DEADLINE_MS = 6e3;
var pendingByFetcher = /* @__PURE__ */ new WeakMap();
function verifyPrivateAuth(request, env, fetchImpl) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return verifyOpsAuth(authorization, env, fetchImpl);
  let pending = pendingByFetcher.get(fetchImpl);
  if (!pending) {
    pending = /* @__PURE__ */ new Map();
    pendingByFetcher.set(fetchImpl, pending);
  }
  const key = createHash("sha256").update(JSON.stringify([env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, authorization])).digest("hex");
  const existing = pending.get(key);
  if (existing) return existing;
  const unavailable = { ok: false, status: 502, reason: "AUTH_PROVIDER_UNAVAILABLE" };
  if (pending.size >= 64) return Promise.resolve(unavailable);
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(unavailable);
    }, AUTH_DEADLINE_MS);
  });
  const boundedFetch = ((input, init) => fetchImpl(input, { ...init, signal: controller.signal }));
  const work = Promise.race([verifyOpsAuth(authorization, env, boundedFetch), deadline]).catch(() => unavailable).then((result) => controller.signal.aborted ? unavailable : result).finally(() => {
    clearTimeout(timer);
    pending.delete(key);
  });
  pending.set(key, work);
  return work;
}

// private-ops-radar-integration/web/ops/scripts/private-radar-gateway.ts
var prefix = "/api/v1/radar/";
var privateHeaders = { "Cache-Control": "private, no-store", "Vary": "Authorization", "X-Content-Type-Options": "nosniff" };
function error(status, reason) {
  return new Response(JSON.stringify({ error: reason }), { status, headers: { ...privateHeaders, "Content-Type": "application/json" } });
}
function route(url, env) {
  if (!["http://127.0.0.1:8787", "http://127.0.0.1:8787/"].includes(env.OPS_PRIVATE_RADAR_BASE_URL ?? "")) return null;
  const path = url.pathname;
  const metadata = /^\/api\/v1\/radar\/frame\/[a-f0-9]{16,64}\/metadata$/.test(path);
  const tile = path.match(/^\/api\/v1\/radar\/tiles\/([a-f0-9]{16,64})\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.png$/);
  const target = new URL(path, "http://127.0.0.1:8787");
  if (metadata || tile) {
    if (url.search) return null;
    if (tile) {
      const [z, x, y] = tile.slice(2).map(Number);
      if (z > 16 || x >= 2 ** z || y >= 2 ** z) return null;
    }
    return { target, png: !!tile };
  }
  if (path !== prefix + "frames" || env.OPS_PRIVATE_RADAR_SITE !== "KSRX") return null;
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 4 || new Set(keys).size !== 4 || keys.some((k) => !["site", "product", "tilt", "limit"].includes(k))) return null;
  const site = url.searchParams.get("site"), product = url.searchParams.get("product"), tilt = url.searchParams.get("tilt");
  if (site !== "KSRX" || !["REF", "VEL", "CC"].includes(product ?? "") || tilt !== (product === "VEL" ? "2" : "1") || url.searchParams.get("limit") !== "1") return null;
  for (const k of ["site", "product", "tilt", "limit"]) target.searchParams.set(k, url.searchParams.get(k));
  return { target, png: false };
}
function createPrivateRadarGateway() {
  let inFlight = 0;
  return async (request, env, fetchImpl = fetch) => {
    const auth = await verifyPrivateAuth(request, env, fetchImpl);
    if (!auth.ok) return error(auth.status, auth.reason);
    if (request.method !== "GET") return error(405, "METHOD_NOT_ALLOWED");
    if (!env.OPS_PRIVATE_RADAR_BASE_URL) return error(503, "RADAR_NOT_CONFIGURED");
    const match = route(new URL(request.url), env);
    if (!match) return error(404, "RADAR_ROUTE_NOT_ALLOWED");
    if (inFlight >= 16) return error(503, "RADAR_GATEWAY_BUSY");
    inFlight++;
    const controller = new AbortController(), abort = () => controller.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) abort();
    const timer = setTimeout(abort, 1e4);
    let reader, upstream;
    try {
      const cancelled = new Promise((_, reject) => {
        if (controller.signal.aborted) reject(Error("aborted"));
        else controller.signal.addEventListener("abort", () => reject(Error("aborted")), { once: true });
      });
      upstream = await Promise.race([fetchImpl(match.target, { method: "GET", headers: { Accept: match.png ? "image/png" : "application/json" }, redirect: "manual", signal: controller.signal }), cancelled]);
      if (upstream.status >= 300 && upstream.status < 400) return error(502, "RADAR_UPSTREAM_REDIRECT");
      if (![200, 404, 422, 503].includes(upstream.status)) return error(502, "RADAR_UNAVAILABLE");
      const png = match.png && upstream.status === 200, type = upstream.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
      if (type !== (png ? "image/png" : "application/json")) return error(502, "RADAR_INVALID_RESPONSE");
      const max = png ? 1024 * 1024 : 128 * 1024;
      if (Number(upstream.headers.get("Content-Length") ?? 0) > max) return error(502, "RADAR_RESPONSE_TOO_LARGE");
      reader = upstream.body?.getReader();
      let size = 0;
      const chunks = [];
      if (reader) while (true) {
        const item = await Promise.race([reader.read(), cancelled]);
        if (item.done) break;
        size += item.value.byteLength;
        if (size > max) return error(502, "RADAR_RESPONSE_TOO_LARGE");
        chunks.push(item.value);
      }
      const bytes = Buffer.concat(chunks);
      if (png) {
        if (bytes.length < 8 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return error(502, "RADAR_INVALID_RESPONSE");
      } else try {
        JSON.parse(bytes.toString("utf8"));
      } catch {
        return error(502, "RADAR_INVALID_RESPONSE");
      }
      return new Response(bytes, { status: upstream.status, headers: { ...privateHeaders, "Content-Type": png ? "image/png" : "application/json", ...upstream.status === 503 ? { "Retry-After": "2" } : {} } });
    } catch {
      return error(controller.signal.aborted ? 504 : 502, controller.signal.aborted ? "RADAR_TIMEOUT" : "RADAR_UNAVAILABLE");
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", abort);
      controller.abort();
      try {
        const cleanup = reader ? reader.cancel() : upstream?.body?.cancel();
        void cleanup?.catch(() => {
        });
      } catch {
      }
      inFlight--;
    }
  };
}
var handlePrivateRadarRequest = createPrivateRadarGateway();
export {
  createPrivateRadarGateway,
  handlePrivateRadarRequest
};
