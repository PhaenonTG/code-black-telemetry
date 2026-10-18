var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// functions/lib/coreGateway.ts
function resolveAllowlistRoute(routeKey) {
  return CORE_GATEWAY_ALLOWLIST[routeKey] ?? null;
}
function gatewayErrorResponse(status, reason) {
  const body = { error: reason };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
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
var CORE_GATEWAY_ALLOWLIST;
var init_coreGateway = __esm({
  "functions/lib/coreGateway.ts"() {
    "use strict";
    CORE_GATEWAY_ALLOWLIST = {
      "api/forecast/v1/targets": { upstreamPath: "/api/forecast/v1/targets", allowedQueryParams: ["latitude", "longitude", "radius_miles"] },
      "api/forecast/v1/review": { upstreamPath: "/api/forecast/v1/review", allowedQueryParams: ["run", "forecast_hour", "candidate_index"] },
      "api/forecast/v1/runs": { upstreamPath: "/api/forecast/v1/runs", allowedQueryParams: [] },
      "api/forecast/v1/point": { upstreamPath: "/api/forecast/v1/point", allowedQueryParams: ["latitude", "longitude", "run"] },
      "api/forecast/v1/alerts": { upstreamPath: "/api/forecast/v1/alerts", allowedQueryParams: ["latitude", "longitude"] },
      "api/forecast/v1/briefings": { upstreamPath: "/api/forecast/v1/briefings", allowedQueryParams: [] },
      "api/forecast/v1/verified-events": { upstreamPath: "/api/forecast/v1/verified-events", allowedQueryParams: ["latitude", "longitude", "radius_miles", "year"] },
      "api/forecast/v1/hurricane-watch": { upstreamPath: "/api/forecast/v1/hurricane-watch", allowedQueryParams: [] },
      "api/forecast/v1/chase-setups": { upstreamPath: "/api/forecast/v1/chase-setups", allowedQueryParams: [] },
      "api/forecast/v1/chase-setup": { upstreamPath: "/api/forecast/v1/chase-setup", allowedQueryParams: ["setup_id", "revision"] },
      "api/forecast/v1/chase-setup-review": { upstreamPath: "/api/forecast/v1/chase-setup-review", allowedQueryParams: [], methods: ["POST"], opsWrite: "review" },
      "api/forecast/v1/chase-setup-decision": { upstreamPath: "/api/forecast/v1/chase-setup-decision", allowedQueryParams: [], methods: ["POST"], opsWrite: "decision" },
      "api/forecast/v1/chase-setup-policy": { upstreamPath: "/api/forecast/v1/chase-setup-policy", allowedQueryParams: [], methods: ["POST"], opsWrite: "decision" },
      "api/forecast/v1/chase-setup-paid-review": { upstreamPath: "/api/forecast/v1/chase-setup-paid-review", allowedQueryParams: [], methods: ["POST"], opsWrite: "decision" },
      "health": { upstreamPath: "/health", allowedQueryParams: [] },
      "api/fabric/v1/health": { upstreamPath: "/api/fabric/v1/health", allowedQueryParams: [] },
      "api/fabric/v1/units": { upstreamPath: "/api/fabric/v1/units", allowedQueryParams: [] },
      "api/fabric/v1/aegis-status": { upstreamPath: "/api/fabric/v1/aegis-status", allowedQueryParams: [], methods: ["GET"] },
      "api/fabric/v1/aegis-alerts": { upstreamPath: "/api/fabric/v1/aegis-alerts", allowedQueryParams: ["after", "limit"], methods: ["GET"] },
      "api/fabric/v1/aegis-observation-plan": { upstreamPath: "/api/fabric/v1/aegis-observation-plan", allowedQueryParams: [], methods: ["GET"] },
      "api/fabric/v1/aegis-policy": { upstreamPath: "/api/fabric/v1/aegis-policy", allowedQueryParams: [], methods: ["GET"] },
      "api/fabric/v1/aegis-policy/replay": { upstreamPath: "/api/fabric/v1/aegis-policy/replay", allowedQueryParams: [], methods: ["POST"] },
      "api/fabric/v1/stream": { upstreamPath: "/api/fabric/v1/stream", allowedQueryParams: [] },
      "api/storm-intel/v1/health": { upstreamPath: "/api/storm-intel/v1/health", allowedQueryParams: [] },
      "api/storm-intel/v1/point": { upstreamPath: "/api/storm-intel/v1/point", allowedQueryParams: ["latitude", "longitude"] },
      "api/soundings/v1/health": { upstreamPath: "/api/soundings/v1/health", allowedQueryParams: [] },
      "api/soundings/v1/point": {
        upstreamPath: "/api/soundings/v1/point",
        allowedQueryParams: ["latitude", "longitude", "model", "location_name"]
      },
      "api/soundings/v1/search-location": {
        upstreamPath: "/api/soundings/v1/search-location",
        allowedQueryParams: ["city", "state"]
      },
      "api/weather-alert/v1/settings": { upstreamPath: "/api/weather-alert/v1/settings", allowedQueryParams: [], methods: ["GET", "PUT"] },
      "api/weather-alert/v1/status": { upstreamPath: "/api/weather-alert/v1/status", allowedQueryParams: [], methods: ["GET"] },
      // These routes terminate at Core's fixed loopback Status Center bridge. They are deliberately
      // separate from the Status Center's private browser server: OPS authentication is verified
      // above, then both Cloudflare allowlists and Core restrict the only reachable operations.
      "api/ops/status-center/v1/status": { upstreamPath: "/api/ops/status-center/v1/status", allowedQueryParams: [] },
      "api/ops/status-center/v1/radar-control-settings": {
        upstreamPath: "/api/ops/status-center/v1/radar-control-settings",
        allowedQueryParams: [],
        methods: ["GET", "PUT"]
      }
    };
  }
});

// scripts/private-auth.ts
import { createHash } from "node:crypto";
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
var AUTH_DEADLINE_MS, pendingByFetcher;
var init_private_auth = __esm({
  "scripts/private-auth.ts"() {
    "use strict";
    init_coreGateway();
    AUTH_DEADLINE_MS = 6e3;
    pendingByFetcher = /* @__PURE__ */ new WeakMap();
  }
});

// scripts/private-producer-control.ts
var private_producer_control_exports = {};
__export(private_producer_control_exports, {
  handlePrivateProducerControl: () => handlePrivateProducerControl
});
import { createHash as createHash3, timingSafeEqual as timingSafeEqual2 } from "node:crypto";
async function handlePrivateProducerControl(request, env, fetchImpl = fetch) {
  if (env.OPS_PRIVATE_PRODUCER_CONTROLS_ENABLED !== "true") return null;
  const url = new URL(request.url);
  if (!url.pathname.startsWith(prefix2)) return null;
  const path = url.pathname.slice(prefix2.length);
  const workstation = path.startsWith("workstation/");
  const workstationRead = path === "workstation/commands" && request.method === "GET";
  const workstationWrite = request.method === "POST" && ["workstation/status", "workstation/capabilities", "workstation/heartbeat", "workstation/ack", "workstation/launcher/poll"].includes(path);
  if (workstation && path.startsWith("workstation/preview/")) return null;
  if (!workstation && path.startsWith("preview/")) return null;
  const read = request.method === "GET" && (["status", "capabilities", "launcher", "facebook"].includes(path) || new RegExp(`^commands/${id}$`, "i").test(path));
  const write = request.method === "POST" && ["commands", "control-lease", "launcher/prepare"].includes(path) || request.method === "DELETE" && path === "control-lease";
  if (!(workstation ? workstationRead || workstationWrite : read || write)) return fail(404, "PRIVATE_PRODUCER_ROUTE_NOT_ALLOWED");
  const token = env.OPS_PRIVATE_PRODUCER_TOKEN;
  if (!token || token.length < 32) return fail(503, "PRIVATE_PRODUCER_NOT_CONFIGURED");
  const headers = new Headers({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
  let allowed2 = false, userId;
  if (workstation) {
    const supplied = request.headers.get("Authorization") ?? "";
    if (!timingSafeEqual2(createHash3("sha256").update(supplied).digest(), createHash3("sha256").update(`Bearer ${token}`).digest())) return fail(401, "AUTH_REQUIRED");
  } else {
    const auth = await verifyPrivateAuth(request, env, fetchImpl);
    if (!auth.ok) return fail(auth.status, auth.reason);
    userId = auth.userId;
    allowed2 = (env.OPS_PRIVATE_PRODUCER_OPERATOR_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean).includes(userId);
    if (write && !allowed2) return fail(403, "PRODUCER_CONTROL_FORBIDDEN");
    if (allowed2) {
      headers.set("X-Producer-UserId", userId);
      headers.set("X-Producer-Operator", "Private OPS producer");
    }
    if (path === "facebook") return json2(200, { enabled: false, permission: false, canManage: false, broadcast: null, reason: "OBS_OUTPUT_CONTROLS_ONLY" });
  }
  let base;
  try {
    base = new URL(env.OPS_PRIVATE_PRODUCER_BASE_URL ?? "");
    if (base.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(base.hostname) || base.pathname !== "/" || base.username || base.password || base.search || base.hash) throw Error();
  } catch {
    return fail(503, "PRIVATE_PRODUCER_NOT_CONFIGURED");
  }
  const body = request.method === "POST" ? await request.text() : void 0;
  if (body !== void 0 && Buffer.byteLength(body) > (workstation ? 65536 : 4096)) return fail(413, "REQUEST_TOO_LARGE");
  if (path === "commands" && body) {
    let command;
    try {
      command = JSON.parse(body);
    } catch {
      return fail(400, "INVALID_COMMAND");
    }
    if (typeof command?.action !== "string" || !(command.action.startsWith("obs.") || ["preview.start", "preview.stop"].includes(command.action))) return fail(400, "PRIVATE_OBS_COMMAND_REQUIRED");
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, 5e3);
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  try {
    const upstream = await fetchImpl(new URL(url.pathname, base), { method: request.method, headers, body, redirect: "error", signal: controller.signal });
    const reader = upstream.body?.getReader();
    let size = 0;
    const chunks = [];
    if (reader) try {
      for (; ; ) {
        const item = await reader.read();
        if (item.done) break;
        size += item.value.byteLength;
        if (size > 65536) {
          await reader.cancel();
          return fail(502, "PRIVATE_PRODUCER_RESPONSE_INVALID");
        }
        chunks.push(item.value);
      }
    } finally {
      reader.releaseLock();
    }
    if (!upstream.headers.get("Content-Type")?.startsWith("application/json")) return fail(502, "PRIVATE_PRODUCER_RESPONSE_INVALID");
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fail(502, "PRIVATE_PRODUCER_RESPONSE_INVALID");
    if (!workstation && ["status", "launcher"].includes(path) && upstream.ok) {
      payload.controlAccess = { allowed: allowed2, userId };
      if (!("status" in payload) && "producer" in payload) payload.status = payload.producer;
    }
    return json2(upstream.status, payload);
  } catch {
    return fail(503, "PRIVATE_PRODUCER_UNAVAILABLE_OUTCOME_UNKNOWN");
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
  }
}
var prefix2, id, json2, fail;
var init_private_producer_control = __esm({
  "scripts/private-producer-control.ts"() {
    "use strict";
    init_private_auth();
    prefix2 = "/api/producer/v1/";
    id = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
    json2 = (status, body) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    fail = (status, error) => json2(status, { error });
  }
});

// scripts/private-core-gateway.ts
import { createHash as createHash4, createHmac } from "node:crypto";

// functions/lib/ardotCameraRelay.ts
var REFERER = "https://www.idrivearkansas.com/";
var ALLOWED_HOSTS = [/(^|\.)idrivearkansas\.com$/i, /(^|\.)worldssl\.net$/i];
var MAX_REDIRECTS = 4;
var ARDOT_RELAY_PREFIX = "/api/ardot-camera-stream";
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
function isAllowedUpstream(url) {
  return url.protocol === "https:" && ALLOWED_HOSTS.some((pattern) => pattern.test(url.hostname));
}
function rewriteManifest(text, manifestUrl, relayOrigin) {
  return text.split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    let absolute;
    try {
      absolute = new URL(trimmed, manifestUrl);
    } catch {
      return line;
    }
    return `${relayOrigin}${ARDOT_RELAY_PREFIX}?url=${encodeURIComponent(absolute.toString())}`;
  }).join("\n");
}
async function relay(targetUrl, relayOrigin, redirectsLeft) {
  if (!isAllowedUpstream(targetUrl)) {
    return new Response("Upstream host not allowed", { status: 400, headers: CORS_HEADERS });
  }
  let upstream;
  try {
    upstream = await fetch(targetUrl.toString(), { headers: { Referer: REFERER }, redirect: "manual" });
  } catch {
    return new Response("Upstream request failed", { status: 502, headers: CORS_HEADERS });
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get("Location");
    if (!location || redirectsLeft <= 0) {
      return new Response("Redirect could not be followed", { status: 502, headers: CORS_HEADERS });
    }
    return relay(new URL(location, targetUrl), relayOrigin, redirectsLeft - 1);
  }
  const contentType = upstream.headers.get("Content-Type") ?? "";
  const looksLikeManifest = contentType.includes("mpegurl") || /\.m3u8(?:$|\?)/i.test(targetUrl.pathname);
  if (looksLikeManifest) {
    const text = await upstream.text();
    return new Response(rewriteManifest(text, targetUrl, relayOrigin), {
      status: upstream.status,
      headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store", ...CORS_HEADERS }
    });
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": contentType || "video/mp2t", "Cache-Control": "public, max-age=8", ...CORS_HEADERS }
  });
}
async function handleArdotCameraStream(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }
  const incoming = new URL(request.url);
  const target = incoming.searchParams.get("url");
  if (!target) return new Response("Missing url parameter", { status: 400, headers: CORS_HEADERS });
  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response("Invalid url parameter", { status: 400, headers: CORS_HEADERS });
  }
  return relay(targetUrl, incoming.origin, MAX_REDIRECTS);
}

// functions/lib/cameraHealthRelay.ts
var ALLOWED_CAMERA_HOSTS = [/(^|\.)idrivearkansas\.com$/i, /(^|\.)iowadot\.gov$/i, /(^|\.)modot\.org$/i, /(^|\.)kandrive\.gov$/i, /(^|\.)carsprogram\.org$/i, /(^|\.)tn\.gov$/i, /(^|\.)smartway\.tn\.gov$/i];
var MAX_IMAGE_BYTES = 3e6;
var MAX_REDIRECTS2 = 3;
var CAMERA_HEALTH_PATH = "/api/camera-health";
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function allowedCameraUrl(url) {
  return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") && ALLOWED_CAMERA_HOSTS.some((pattern) => pattern.test(url.hostname));
}
async function fetchAllowedCamera(initial) {
  let current = initial;
  for (let hop = 0; hop <= MAX_REDIRECTS2; hop++) {
    if (!allowedCameraUrl(current)) throw new Error("Camera host not allowed");
    const response = await fetch(current.toString(), {
      headers: { Accept: "image/*", "User-Agent": "CodeBlackOPS-CameraHealth/1.0" },
      redirect: "manual",
      signal: AbortSignal.timeout(8e3)
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("Location");
    await response.body?.cancel();
    if (!location || hop === MAX_REDIRECTS2) throw new Error("Camera redirect unavailable");
    current = new URL(location, current);
  }
  throw new Error("Camera redirect limit");
}
async function readBoundedImage(response) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_IMAGE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const image = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    image.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return image;
}
async function handleCameraHealth(request) {
  if (request.method !== "GET") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const raw = new URL(request.url).searchParams.get("url");
  let target;
  try {
    target = new URL(raw ?? "");
  } catch {
    return json({ ok: false, error: "INVALID_URL" }, 400);
  }
  if (!allowedCameraUrl(target)) return json({ ok: false, error: "HOST_NOT_ALLOWED" }, 400);
  try {
    const response = await fetchAllowedCamera(target);
    const contentType = response.headers.get("Content-Type") ?? "";
    if (!response.ok || !contentType.toLowerCase().startsWith("image/")) return json({ ok: false, status: response.status, error: "MEDIA_UNAVAILABLE", checkedAt: Date.now() }, 502);
    if (Number(response.headers.get("Content-Length") ?? 0) > MAX_IMAGE_BYTES) return json({ ok: false, error: "MEDIA_TOO_LARGE", checkedAt: Date.now() }, 413);
    const bytes = await readBoundedImage(response);
    if (!bytes) return json({ ok: false, error: "MEDIA_TOO_LARGE", checkedAt: Date.now() }, 413);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const fingerprint = [...new Uint8Array(digest)].slice(0, 12).map((value) => value.toString(16).padStart(2, "0")).join("");
    return json({ ok: true, status: response.status, fingerprint, bytes: bytes.byteLength, etag: response.headers.get("ETag"), lastModified: response.headers.get("Last-Modified"), checkedAt: Date.now() });
  } catch {
    return json({ ok: false, error: "UPSTREAM_FAILED", checkedAt: Date.now() }, 502);
  }
}

// functions/lib/kandriveRelay.ts
var KANDRIVE_PATH = "/api/kandrive/graphql";
var KANDRIVE_UPSTREAM = "https://www.kandrive.gov/api/graphql";
var MAX_BODY_BYTES = 24e3;
async function handleKandriveRequest(request, fetchImpl = fetch) {
  const url = new URL(request.url);
  if (request.method !== "POST") return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
  if (url.pathname !== KANDRIVE_PATH) return Response.json({ error: "ROUTE_NOT_ALLOWED" }, { status: 404 });
  const body = await request.text();
  if (!body || new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  const isMapFeaturesQuery = typeof parsed.query === "string" && /^\s*query\s+MapFeatures\s*\(/.test(parsed.query) && /\bmapFeaturesQuery\s*\(\s*input\s*:/.test(parsed.query);
  if (!isMapFeaturesQuery || typeof parsed.variables !== "object" || parsed.variables === null) return Response.json({ error: "QUERY_NOT_ALLOWED" }, { status: 400 });
  try {
    const upstream = await fetchImpl(KANDRIVE_UPSTREAM, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "CodeBlackOPS/1.0" }, body });
    if (!upstream.ok) return Response.json({ error: "PROVIDER_UNAVAILABLE" }, { status: 502 });
    return new Response(upstream.body, { headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=30", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return Response.json({ error: "PROVIDER_UNAVAILABLE" }, { status: 502 });
  }
}

// functions/lib/modotRelay.ts
var MODOT_PREFIX = "/api/modot/";
var MODOT_ORIGIN = "https://mapping.modot.org/arcgis/rest/services/TravelerInformation/";
var ALLOWED_SERVICES = /* @__PURE__ */ new Set(["NWSDATA", "TravelerInformationData"]);
var ALLOWED_QUERY = /* @__PURE__ */ new Set([
  "f",
  "outFields",
  "geometry",
  "geometryType",
  "inSR",
  "spatialRel",
  "resultRecordCount",
  "where",
  "returnGeometry",
  "outSR"
]);
function resolveModotUrl(requestUrl) {
  if (!requestUrl.pathname.startsWith(MODOT_PREFIX)) return null;
  const parts = requestUrl.pathname.slice(MODOT_PREFIX.length).split("/").filter(Boolean);
  if (parts.length !== 4 || !ALLOWED_SERVICES.has(parts[0]) || parts[1] !== "MapServer" || !/^\d+$/.test(parts[2]) || parts[3] !== "query") return null;
  const upstream = new URL(`${parts[0]}/MapServer/${parts[2]}/query`, MODOT_ORIGIN);
  for (const [key, value] of requestUrl.searchParams) {
    if (ALLOWED_QUERY.has(key)) upstream.searchParams.set(key, value);
  }
  upstream.searchParams.set("f", "geojson");
  return upstream;
}
async function handleModotRequest(request, fetchImpl = fetch) {
  if (request.method !== "GET") return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: { "Content-Type": "application/json" } });
  const upstream = resolveModotUrl(new URL(request.url));
  if (!upstream) return new Response(JSON.stringify({ error: "ROUTE_NOT_ALLOWED" }), { status: 404, headers: { "Content-Type": "application/json" } });
  try {
    const response = await fetchImpl(upstream, { headers: { Accept: "application/geo+json, application/json" }, cf: { cacheTtl: 60, cacheEverything: true } });
    if (!response.ok) return new Response(JSON.stringify({ error: "PROVIDER_UNAVAILABLE" }), { status: 502, headers: { "Content-Type": "application/json" } });
    return new Response(response.body, {
      status: 200,
      headers: { "Content-Type": "application/geo+json", "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" }
    });
  } catch {
    return new Response(JSON.stringify({ error: "PROVIDER_UNAVAILABLE" }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}

// functions/lib/odotRelay.ts
var ODOT_PREFIX = "/api/odot/";
var ODOT_ORIGIN = "https://oktraffic.org/api/Geojsons/";
var ALLOWED_FEEDS = /* @__PURE__ */ new Set(["workzones", "closures"]);
var USDOT_REGISTRY_URL = "https://data.transportation.gov/resource/69qe-yiui.json?$limit=500";
async function resolvePublicRegistryToken(fetchImpl) {
  try {
    const response = await fetchImpl(USDOT_REGISTRY_URL, { headers: { Accept: "application/json" }, cf: { cacheTtl: 3600, cacheEverything: true } });
    if (!response.ok) return null;
    const rows = await response.json();
    const row = rows.find((item) => String(item.state).toLowerCase() === "oklahoma" && String(item.active).toLowerCase() !== "no");
    const rawUrl = row && typeof row.url === "object" && row.url ? String(row.url.url ?? "") : String(row?.url ?? "");
    return new URL(rawUrl).searchParams.get("access_token");
  } catch {
    return null;
  }
}
function resolveOdotUrl(requestUrl, token) {
  if (!requestUrl.pathname.startsWith(ODOT_PREFIX)) return null;
  const feed = requestUrl.pathname.slice(ODOT_PREFIX.length);
  if (!ALLOWED_FEEDS.has(feed)) return null;
  const upstream = new URL(feed, ODOT_ORIGIN);
  upstream.searchParams.set("access_token", token);
  return upstream;
}
async function handleOdotRequest(request, env, fetchImpl = fetch) {
  if (request.method !== "GET") return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
  const token = env.ODOT_WZDX_ACCESS_TOKEN || await resolvePublicRegistryToken(fetchImpl);
  if (!token) return Response.json({ error: "PROVIDER_NOT_CONFIGURED" }, { status: 501 });
  const upstream = resolveOdotUrl(new URL(request.url), token);
  if (!upstream) return Response.json({ error: "ROUTE_NOT_ALLOWED" }, { status: 404 });
  try {
    const response = await fetchImpl(upstream, { headers: { Accept: "application/json" }, cf: { cacheTtl: 60, cacheEverything: true } });
    if (!response.ok) return Response.json({ error: "PROVIDER_UNAVAILABLE" }, { status: 502 });
    return new Response(response.body, { status: 200, headers: { "Content-Type": "application/geo+json", "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return Response.json({ error: "PROVIDER_UNAVAILABLE" }, { status: 502 });
  }
}

// functions/lib/tdotRelay.ts
var TDOT_PREFIX = "/api/tdot/";
var TDOT_ORIGIN = "https://www.tdot.tn.gov/opendata/api/public/";
var TDOT_PUBLIC_API_KEY = "8d3b7a82635d476795c09b2c41facc60";
var ALLOWED_ENDPOINTS = /* @__PURE__ */ new Set([
  "RoadwayCameras",
  "RoadwayIncidents",
  "RoadwayOperations",
  "RoadwayWeather",
  "RoadwaySevereImpact"
]);
function resolveTdotEndpoint(requestUrl) {
  if (!requestUrl.pathname.startsWith(TDOT_PREFIX)) return null;
  const endpoint = requestUrl.pathname.slice(TDOT_PREFIX.length);
  if (!ALLOWED_ENDPOINTS.has(endpoint)) return null;
  return new URL(endpoint, TDOT_ORIGIN);
}
async function handleTdotRequest(request, fetchImpl = fetch) {
  if (request.method !== "GET") return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
  const upstream = resolveTdotEndpoint(new URL(request.url));
  if (!upstream) return Response.json({ error: "ROUTE_NOT_ALLOWED" }, { status: 404 });
  try {
    const response = await fetchImpl(upstream, {
      headers: { Accept: "application/json", "X-API-Key": TDOT_PUBLIC_API_KEY },
      cf: { cacheTtl: 60, cacheEverything: true }
    });
    if (!response.ok) return Response.json({ error: "PROVIDER_UNAVAILABLE" }, { status: 502 });
    if (response.status === 204) return new Response("[]", {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" }
    });
    return new Response(response.body, {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" }
    });
  } catch {
    return Response.json({ error: "PROVIDER_UNAVAILABLE" }, { status: 502 });
  }
}

// scripts/private-core-gateway.ts
init_private_auth();

// scripts/private-provider-fetch.ts
var maxProviderBytes = 5e6;
var maxEntries = 64;
var allowedPaths = {
  "www.kandrive.gov": "/api/graphql",
  "mapping.modot.org": "/arcgis/rest/services/TravelerInformation/",
  "oktraffic.org": "/api/Geojsons/",
  "data.transportation.gov": "/resource/69qe-yiui.json",
  "www.tdot.tn.gov": "/opendata/api/public/"
};
var cache = /* @__PURE__ */ new Map();
function allowed(url) {
  const prefix4 = allowedPaths[url.hostname];
  return url.protocol === "https:" && Boolean(prefix4) && (url.pathname === prefix4 || prefix4.endsWith("/") && url.pathname.startsWith(prefix4)) && !url.username && !url.password && !url.hash && (url.port === "" || url.port === "443");
}
async function limitedBytes(response) {
  if (Number(response.headers.get("Content-Length") ?? 0) > maxProviderBytes) throw new Error("Provider response too large");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxProviderBytes) {
      await reader.cancel();
      throw new Error("Provider response too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
function restored(entry) {
  return new Response([204, 205, 304].includes(entry.status) ? null : entry.bytes.slice(), {
    status: entry.status,
    headers: { "Content-Type": entry.contentType }
  });
}
async function privateProviderFetch(input, init = {}, upstreamFetch = fetch) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!allowed(url)) throw new Error("Provider URL not allowed");
  const method = init.method || "GET";
  if (method !== "GET" && !(url.hostname === "www.kandrive.gov" && method === "POST"))
    throw new Error("Provider method not allowed");
  const body = typeof init.body === "string" ? init.body : void 0;
  if (method === "POST" && (!body || Buffer.byteLength(body) > 24e3)) throw new Error("Provider request too large");
  const key = `${method} ${url.href} ${body ?? ""}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return restored(cached);
  if (cached) cache.delete(key);
  const upstream = await upstreamFetch(url, {
    method,
    headers: init.headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(15e3)
  });
  if (upstream.status >= 300 && upstream.status < 400) throw new Error("Provider redirect rejected");
  const bytes = await limitedBytes(upstream);
  const entry = {
    expiresAt: Date.now() + (url.hostname === "data.transportation.gov" ? 3600 : method === "POST" ? 30 : 60) * 1e3,
    status: upstream.status,
    bytes,
    contentType: upstream.headers.get("Content-Type") || "application/json"
  };
  if (upstream.ok) {
    if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
    cache.set(key, entry);
  }
  return restored(entry);
}

// scripts/private-producer-gateway.ts
init_coreGateway();
init_private_auth();
import { createHash as createHash2, timingSafeEqual } from "node:crypto";
var prefix = "/api/producer/v1/";
var segment = /^preview\/hls\/program-[0-9a-f]{32}-[0-9]{1,16}\.ts$/;
var workstationPrefix = "/api/producer/v1/workstation/";
var workstationSegment = /^preview\/hls\/program-[0-9a-f]{32}-[0-9]{1,16}\.ts$/;
function ingestRoute(path) {
  if (path === "status" || path === "capabilities") return { type: "application/json", limit: 64 * 1024 };
  if (path === "preview/program.jpg") return { type: "image/jpeg", limit: 2 * 1024 * 1024 };
  if (path === "preview/hls/index.m3u8") return { type: "application/vnd.apple.mpegurl", limit: 64 * 1024 };
  if (workstationSegment.test(path)) return { type: "video/mp2t", limit: 512 * 1024 };
  return null;
}
function validIngestToken(header, token) {
  if (!token || token.length < 32 || !header?.startsWith("Bearer ")) return false;
  const supplied = createHash2("sha256").update(header.slice(7)).digest();
  const expected = createHash2("sha256").update(token).digest();
  return timingSafeEqual(supplied, expected);
}
function route(path) {
  if (path === "status" || path === "capabilities") return { type: "application/json", limit: 64 * 1024 };
  if (path === "preview/program.jpg") return { type: "image/jpeg", limit: 2 * 1024 * 1024 };
  if (path === "preview/hls/index.m3u8") return { type: "application/vnd.apple.mpegurl", limit: 64 * 1024 };
  if (segment.test(path)) return { type: "video/mp2t", limit: 512 * 1024 };
  return null;
}
function localProducerUrl(raw) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash ? url : null;
  } catch {
    return null;
  }
}
function boundedSignal(request) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, 5e3);
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  return { signal: controller.signal, dispose: () => {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
  } };
}
function waitForMedia(signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new Error("PRIVATE_MEDIA_REQUEST_CANCELLED"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 250);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
async function handlePrivateProducerWrite(request, env, fetchImpl = fetch) {
  const path = new URL(request.url).pathname;
  const allowed2 = request.method === "POST" && path.startsWith(workstationPrefix) ? ingestRoute(path.slice(workstationPrefix.length)) : null;
  if (!allowed2) return gatewayErrorResponse(503, "SHADOW_READ_ONLY");
  if (!validIngestToken(request.headers.get("Authorization"), env.OPS_PRIVATE_PRODUCER_TOKEN))
    return gatewayErrorResponse(401, "AUTH_REQUIRED");
  const base = localProducerUrl(env.OPS_PRIVATE_PRODUCER_BASE_URL);
  if (!base) return gatewayErrorResponse(502, "CORE_UNAVAILABLE");
  if (request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== allowed2.type)
    return gatewayErrorResponse(415, "UNSUPPORTED_MEDIA_TYPE");
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > allowed2.limit) return gatewayErrorResponse(413, "REQUEST_TOO_LARGE");
  const headers = new Headers({ Authorization: `Bearer ${env.OPS_PRIVATE_PRODUCER_TOKEN}`, "Content-Type": allowed2.type });
  for (const name of ["X-Producer-Frame-At", "X-Producer-Composition"]) {
    const value = request.headers.get(name);
    if (value && /^[\x20-\x7e]{1,256}$/.test(value)) headers.set(name, value);
  }
  const bounded = boundedSignal(request);
  try {
    const upstream = await fetchImpl(new URL(path, base), {
      method: "POST",
      headers,
      body,
      redirect: "error",
      signal: bounded.signal
    });
    await upstream.body?.cancel();
    if (upstream.ok) return Response.json({ accepted: true }, { headers: { "Cache-Control": "no-store" } });
    return gatewayErrorResponse(
      upstream.status === 413 ? 413 : 502,
      upstream.status === 413 ? "REQUEST_TOO_LARGE" : "CORE_UNAVAILABLE"
    );
  } catch {
    return gatewayErrorResponse(502, "CORE_UNAVAILABLE");
  } finally {
    bounded.dispose();
  }
}
async function boundedBody(response, limit) {
  const length = response.headers.get("Content-Length");
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
async function handlePrivateProducerRead(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(prefix)) return gatewayErrorResponse(404, "ROUTE_NOT_ALLOWED");
  const allowed2 = request.method === "GET" ? route(url.pathname.slice(prefix.length)) : null;
  if (!allowed2) return new Response(JSON.stringify({ error: "SHADOW_READ_ONLY" }), {
    status: 503,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
  const auth = await verifyPrivateAuth(request, env, fetchImpl);
  if (!auth.ok) return gatewayErrorResponse(auth.status, auth.reason);
  const base = localProducerUrl(env.OPS_PRIVATE_PRODUCER_BASE_URL);
  const token = env.OPS_PRIVATE_PRODUCER_TOKEN;
  if (!base || !token || token.length < 32) return gatewayErrorResponse(502, "CORE_UNAVAILABLE");
  const target = new URL(url.pathname, base);
  const bounded = boundedSignal(request);
  try {
    const warmUntil = Date.now() + 4e3;
    let upstream;
    for (; ; ) {
      upstream = await fetchImpl(target, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: allowed2.type },
        redirect: "manual",
        signal: bounded.signal
      });
      if (upstream.status !== 404 || url.pathname !== `${prefix}preview/hls/index.m3u8` || Date.now() >= warmUntil) break;
      await upstream.body?.cancel();
      await waitForMedia(bounded.signal);
    }
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return gatewayErrorResponse(
        upstream.status === 404 ? 404 : 502,
        upstream.status === 404 ? "ROUTE_NOT_ALLOWED" : "CORE_UNAVAILABLE"
      );
    }
    const contentType = upstream.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== allowed2.type) {
      await upstream.body?.cancel();
      return gatewayErrorResponse(502, "CORE_MALFORMED_RESPONSE");
    }
    const bytes = await boundedBody(upstream, allowed2.limit);
    if (!bytes) return gatewayErrorResponse(502, "CORE_MALFORMED_RESPONSE");
    if (allowed2.type === "application/json") {
      let payload;
      try {
        payload = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return gatewayErrorResponse(502, "CORE_MALFORMED_RESPONSE");
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        return gatewayErrorResponse(502, "CORE_MALFORMED_RESPONSE");
      if (url.pathname === `${prefix}status`) {
        payload = { ...payload, controlAccess: { allowed: false, userId: auth.userId }, controlLease: null };
      }
      return new Response(JSON.stringify(payload), { status: 200, headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      } });
    }
    const headers = new Headers({ "Content-Type": allowed2.type, "Cache-Control": "no-store, no-transform", "X-Content-Type-Options": "nosniff" });
    if (["image/jpeg", "application/vnd.apple.mpegurl", "video/mp2t"].includes(allowed2.type)) {
      for (const name of ["X-Producer-Frame-At", "X-Producer-Composition"]) {
        const value = upstream.headers.get(name);
        if (value && /^[\x20-\x7e]{1,256}$/.test(value)) headers.set(name, value);
      }
    }
    return new Response(bytes, { status: 200, headers });
  } catch {
    return gatewayErrorResponse(502, "CORE_UNAVAILABLE");
  } finally {
    bounded.dispose();
  }
}

// scripts/private-core-gateway.ts
init_coreGateway();
var prefix3 = "/api/core/";
var maxPostBytes = 4096;
var maxPutBytes = 64 * 1024;
var maxResponseBytes = 2e6;
var overlayPrefix = "/overlay-core";
var overlayCors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };
function localCoreUrl(base) {
  if (!base) return null;
  try {
    const url = new URL(base);
    return url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash ? url : null;
  } catch {
    return null;
  }
}
function signedActorHeaders(path, body, actor, role, secret) {
  const timestamp = String(Math.floor(Date.now() / 1e3));
  const hash = createHash4("sha256").update(body).digest("hex");
  const message = ["POST", path, timestamp, actor, role, hash].join("\n");
  return {
    "X-Ops-User-Id": actor,
    "X-Ops-Role": role,
    "X-Ops-Timestamp": timestamp,
    "X-Ops-Signature": createHmac("sha256", secret).update(message).digest("hex")
  };
}
async function handlePrivateCoreRequest(request, env, fetchImpl = fetch) {
  const started = performance.now();
  const auth = await verifyPrivateAuth(request, env, fetchImpl);
  const authMs = performance.now() - started;
  if (!auth.ok) return gatewayErrorResponse(auth.status, auth.reason);
  const incomingUrl = new URL(request.url);
  if (!incomingUrl.pathname.startsWith(prefix3)) return gatewayErrorResponse(404, "ROUTE_NOT_ALLOWED");
  const key = incomingUrl.pathname.slice(prefix3.length);
  const route2 = resolveAllowlistRoute(key);
  if (!route2) return gatewayErrorResponse(404, "ROUTE_NOT_ALLOWED");
  if (!(route2.methods ?? ["GET"]).includes(request.method)) return gatewayErrorResponse(405, "METHOD_NOT_ALLOWED");
  if (route2.opsWrite && (!auth.role || route2.opsWrite === "decision" && !["OWNER", "ADMIN"].includes(auth.role)))
    return gatewayErrorResponse(403, "UNAUTHORIZED");
  const base = localCoreUrl(env.OPS_PRIVATE_CORE_BASE_URL);
  if (!base) return gatewayErrorResponse(502, "CORE_UNAVAILABLE");
  const target = new URL(route2.upstreamPath, base);
  for (const param of route2.allowedQueryParams) {
    const value = incomingUrl.searchParams.get(param);
    if (value !== null) target.searchParams.set(param, value);
  }
  let body;
  if (request.method === "POST" || request.method === "PUT") {
    const maxWriteBytes = request.method === "PUT" ? maxPutBytes : maxPostBytes;
    if (Number(request.headers.get("Content-Length") ?? 0) > maxWriteBytes)
      return gatewayErrorResponse(413, "REQUEST_TOO_LARGE");
    body = await request.text();
    if (Buffer.byteLength(body) > maxWriteBytes) return gatewayErrorResponse(413, "REQUEST_TOO_LARGE");
  }
  if (route2.opsWrite && !env.OPS_PRIVATE_WRITE_SECRET) return gatewayErrorResponse(502, "CORE_UNAVAILABLE");
  const headers = {
    Accept: route2.upstreamPath === "/api/fabric/v1/stream" ? "application/x-ndjson" : "application/json",
    ...body === void 0 ? {} : { "Content-Type": "application/json" },
    ...route2.opsWrite ? signedActorHeaders(route2.upstreamPath, body ?? "", auth.userId, auth.role, env.OPS_PRIVATE_WRITE_SECRET) : {}
  };
  const controller = new AbortController();
  const cancel = () => controller.abort();
  request.signal.addEventListener("abort", cancel, { once: true });
  if (request.signal.aborted) controller.abort();
  const telemetry = route2.upstreamPath.startsWith("/api/ops/status-center/v1/");
  const timer = setTimeout(cancel, route2.upstreamPath === "/api/fabric/v1/stream" ? 12e4 : telemetry ? 5e3 : 25e3);
  try {
    const upstream = await fetchImpl(target, { method: request.method, body, headers, signal: controller.signal, redirect: "manual" });
    if (route2.upstreamPath === "/api/fabric/v1/stream") {
      if (!upstream.ok || !upstream.body || !upstream.headers.get("Content-Type")?.startsWith("application/x-ndjson")) {
        await upstream.body?.cancel();
        return gatewayErrorResponse(502, "CORE_UNAVAILABLE");
      }
      return new Response(upstream.body, { status: 200, headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-transform"
      } });
    }
    const length = Number(upstream.headers.get("Content-Length") ?? 0);
    if (length > maxResponseBytes) return gatewayErrorResponse(502, "CORE_MALFORMED_RESPONSE");
    const text = await upstream.text();
    if (Buffer.byteLength(text) > maxResponseBytes) return gatewayErrorResponse(502, "CORE_MALFORMED_RESPONSE");
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      return gatewayErrorResponse(502, "CORE_MALFORMED_RESPONSE");
    }
    if (route2.upstreamPath === "/api/soundings/v1/search-location" && upstream.status === 404)
      return gatewayErrorResponse(404, "LOCATION_NOT_FOUND");
    if (!upstream.ok) {
      if (route2.opsWrite && [403, 409, 422].includes(upstream.status)) {
        const error = upstream.status === 409 ? "SETUP_CONFLICT" : upstream.status === 403 ? "UNAUTHORIZED" : "INVALID_REQUEST";
        return new Response(JSON.stringify({ error }), { status: upstream.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
      }
      return gatewayErrorResponse(502, "CORE_UNAVAILABLE");
    }
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Server-Timing": `auth;dur=${authMs.toFixed(1)},core;dur=${(performance.now() - started - authMs).toFixed(1)}` } });
  } catch (error) {
    return gatewayErrorResponse(
      error instanceof DOMException && error.name === "AbortError" ? 504 : 502,
      error instanceof DOMException && error.name === "AbortError" ? "CORE_TIMEOUT" : "CORE_UNAVAILABLE"
    );
  } finally {
    clearTimeout(timer);
    if (route2.upstreamPath !== "/api/fabric/v1/stream") request.signal.removeEventListener("abort", cancel);
  }
}
async function handlePrivateOverlayRequest(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(`${overlayPrefix}/`)) return gatewayErrorResponse(404, "ROUTE_NOT_ALLOWED");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: overlayCors });
  if (request.method !== "GET") return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), {
    status: 405,
    headers: { "Content-Type": "application/json", ...overlayCors }
  });
  if (url.pathname === "/overlay-core/mapbox-token") {
    return new Response(JSON.stringify(env.MAPBOX_PUBLIC_TOKEN ? { token: env.MAPBOX_PUBLIC_TOKEN } : { error: "MAPBOX_TOKEN_NOT_CONFIGURED" }), {
      status: env.MAPBOX_PUBLIC_TOKEN ? 200 : 503,
      headers: { "Content-Type": "application/json", "Cache-Control": env.MAPBOX_PUBLIC_TOKEN ? "public, max-age=3600" : "no-store", ...overlayCors }
    });
  }
  const path = url.pathname.slice(overlayPrefix.length);
  const params = path === "/api/storm-intel/v1/health" ? [] : path === "/api/storm-intel/v1/point" ? ["latitude", "longitude"] : null;
  if (!params) return new Response(JSON.stringify({ error: "ROUTE_NOT_ALLOWED" }), {
    status: 404,
    headers: { "Content-Type": "application/json", ...overlayCors }
  });
  const base = localCoreUrl(env.OPS_PRIVATE_CORE_BASE_URL);
  if (!base) return new Response(JSON.stringify({ error: "CORE_UNAVAILABLE" }), {
    status: 502,
    headers: { "Content-Type": "application/json", ...overlayCors }
  });
  const target = new URL(path, base);
  for (const key of params) {
    const value = url.searchParams.get(key);
    if (value !== null) target.searchParams.set(key, value);
  }
  try {
    const upstream = await fetchImpl(target, { headers: { Accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(25e3) });
    if (!upstream.ok || Number(upstream.headers.get("Content-Length") ?? 0) > maxResponseBytes)
      throw new Error("Core unavailable");
    const text = await upstream.text();
    if (Buffer.byteLength(text) > maxResponseBytes) throw new Error("Core response too large");
    const body = JSON.parse(text);
    return new Response(JSON.stringify(body), { status: 200, headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...overlayCors
    } });
  } catch {
    return new Response(JSON.stringify({ error: "CORE_UNAVAILABLE" }), {
      status: 502,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...overlayCors }
    });
  }
}
async function handlePrivateApiRequest(request, env, fetchImpl = fetch) {
  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/producer/v1/")) {
    const { handlePrivateProducerControl: handlePrivateProducerControl2 } = await Promise.resolve().then(() => (init_private_producer_control(), private_producer_control_exports));
    const response = await handlePrivateProducerControl2(request, env, fetchImpl);
    if (response) return response;
  }
  if (path.startsWith("/api/core/")) return handlePrivateCoreRequest(request, env, fetchImpl);
  if (path.startsWith("/api/producer/v1/workstation/")) return handlePrivateProducerWrite(request, env, fetchImpl);
  if (path.startsWith("/api/producer/v1/")) return handlePrivateProducerRead(request, env, fetchImpl);
  if (path.startsWith("/overlay-core/")) return handlePrivateOverlayRequest(request, env, fetchImpl);
  if (path === CAMERA_HEALTH_PATH) return handleCameraHealth(request);
  if (path === ARDOT_RELAY_PREFIX) return handleArdotCameraStream(request);
  if (path === KANDRIVE_PATH) return handleKandriveRequest(request, privateProviderFetch);
  if (path.startsWith(MODOT_PREFIX)) return handleModotRequest(request, privateProviderFetch);
  if (path.startsWith(ODOT_PREFIX)) return handleOdotRequest(request, env, privateProviderFetch);
  if (path.startsWith(TDOT_PREFIX)) return handleTdotRequest(request, privateProviderFetch);
  return Promise.resolve(gatewayErrorResponse(404, "ROUTE_NOT_ALLOWED"));
}
export {
  handlePrivateApiRequest,
  handlePrivateCoreRequest,
  handlePrivateOverlayRequest
};
