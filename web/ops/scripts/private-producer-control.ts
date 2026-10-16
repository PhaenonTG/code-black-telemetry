import { createHash, timingSafeEqual } from "node:crypto";
import { verifyPrivateAuth } from "./private-auth";
import type { PrivateProducerEnv } from "./private-producer-gateway";

export interface ProducerControlEnv extends PrivateProducerEnv {
  OPS_PRIVATE_PRODUCER_CONTROLS_ENABLED?: string;
  OPS_PRIVATE_PRODUCER_OPERATOR_IDS?: string;
}
const prefix = "/api/producer/v1/";
const id = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const fail = (status: number, error: string) => json(status, { error });

// Opt-in private replacement, not a proxy to the public Worker. Existing shadow
// behavior remains unchanged until the single-consumer migration is qualified.
export async function handlePrivateProducerControl(request: Request, env: ProducerControlEnv, fetchImpl: typeof fetch = fetch): Promise<Response | null> {
  if (env.OPS_PRIVATE_PRODUCER_CONTROLS_ENABLED !== "true") return null;
  const url = new URL(request.url);
  if (!url.pathname.startsWith(prefix)) return null;
  const path = url.pathname.slice(prefix.length);
  const workstation = path.startsWith("workstation/");
  const workstationRead = path === "workstation/commands" && request.method === "GET";
  const workstationWrite = request.method === "POST" && ["workstation/status", "workstation/capabilities", "workstation/heartbeat", "workstation/ack", "workstation/launcher/poll"].includes(path);
  // Media retains the existing authenticated, size/freshness-bounded relay.
  if (workstation && path.startsWith("workstation/preview/")) return null;
  if (!workstation && path.startsWith("preview/")) return null;
  const read = request.method === "GET" && (["status", "capabilities", "launcher", "facebook"].includes(path) || new RegExp(`^commands/${id}$`, "i").test(path));
  const write = (request.method === "POST" && ["commands", "control-lease", "launcher/prepare"].includes(path)) || (request.method === "DELETE" && path === "control-lease");
  if (!(workstation ? workstationRead || workstationWrite : read || write)) return fail(404, "PRIVATE_PRODUCER_ROUTE_NOT_ALLOWED");

  const token = env.OPS_PRIVATE_PRODUCER_TOKEN;
  if (!token || token.length < 32) return fail(503, "PRIVATE_PRODUCER_NOT_CONFIGURED");
  const headers = new Headers({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
  let allowed = false, userId: string | undefined;
  if (workstation) {
    const supplied = request.headers.get("Authorization") ?? "";
    if (!timingSafeEqual(createHash("sha256").update(supplied).digest(), createHash("sha256").update(`Bearer ${token}`).digest())) return fail(401, "AUTH_REQUIRED");
  } else {
    const auth = await verifyPrivateAuth(request, env, fetchImpl);
    if (!auth.ok) return fail(auth.status, auth.reason);
    userId = auth.userId;
    allowed = (env.OPS_PRIVATE_PRODUCER_OPERATOR_IDS ?? "").split(",").map(value => value.trim()).filter(Boolean).includes(userId);
    if (write && !allowed) return fail(403, "PRODUCER_CONTROL_FORBIDDEN");
    if (allowed) { headers.set("X-Producer-UserId", userId); headers.set("X-Producer-Operator", "Private OPS producer"); }
    if (path === "facebook") return json(200, { enabled: false, permission: false, canManage: false, broadcast: null, reason: "OBS_OUTPUT_CONTROLS_ONLY" });
  }
  let base: URL;
  try {
    base = new URL(env.OPS_PRIVATE_PRODUCER_BASE_URL ?? "");
    if (base.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(base.hostname) || base.pathname !== "/" || base.username || base.password || base.search || base.hash) throw Error();
  } catch { return fail(503, "PRIVATE_PRODUCER_NOT_CONFIGURED"); }
  const body = request.method === "POST" ? await request.text() : undefined;
  if (body !== undefined && Buffer.byteLength(body) > (workstation ? 65536 : 4096)) return fail(413, "REQUEST_TOO_LARGE");
  if (path === "commands" && body) {
    let command: { action?: string };
    try { command = JSON.parse(body); } catch { return fail(400, "INVALID_COMMAND"); }
    // Never enable the legacy Facebook lifecycle/output path on this adapter.
    if (typeof command?.action !== "string" || !(command.action.startsWith("obs.") || ["preview.start", "preview.stop"].includes(command.action))) return fail(400, "PRIVATE_OBS_COMMAND_REQUIRED");
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, 5000);
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  try {
    const upstream = await fetchImpl(new URL(url.pathname, base), { method: request.method, headers, body, redirect: "error", signal: controller.signal });
    const reader = upstream.body?.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    if (reader) try {
      for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength; if (size > 65536) { await reader.cancel(); return fail(502, "PRIVATE_PRODUCER_RESPONSE_INVALID"); } chunks.push(item.value); }
    } finally { reader.releaseLock(); }
    if (!upstream.headers.get("Content-Type")?.startsWith("application/json")) return fail(502, "PRIVATE_PRODUCER_RESPONSE_INVALID");
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fail(502, "PRIVATE_PRODUCER_RESPONSE_INVALID");
    if (!workstation && ["status", "launcher"].includes(path) && upstream.ok) {
      payload.controlAccess = { allowed, userId };
      if (!("status" in payload) && "producer" in payload) payload.status = payload.producer;
    }
    return json(upstream.status, payload);
  } catch { return fail(503, "PRIVATE_PRODUCER_UNAVAILABLE_OUTCOME_UNKNOWN"); }
  finally { clearTimeout(timer); request.signal.removeEventListener("abort", abort); }
}
