// Standalone Core Gateway VPC transport Worker.
//
// This Worker has exactly one job: take an already-authenticated, already-allowlisted request
// forwarded from the OPS Pages gateway (over an internal Cloudflare Service Binding) and
// transport it to Core through a Workers VPC Service binding, instead of the public
// Access-protected tunnel hostname the Pages gateway uses today.
//
// Trust boundary: this Worker is NOT publicly reachable (workers_dev disabled, no routes, no
// custom domain -- see wrangler.jsonc). It trusts its caller because the only caller that can
// reach it is the OPS Pages project's own Worker, over a Service Binding, which never leaves
// Cloudflare's internal network. Supabase user authentication and profile/RLS authorization
// happen entirely on the Pages side (web/ops/functions/lib/coreGateway.ts) and are
// deliberately NOT duplicated here -- duplicating them would mean maintaining two copies of a
// security-critical check with no corresponding security benefit, since this Worker's own
// allowlist below is what actually earns "defense in depth" here.
//
// This is NOT an open proxy: CORE_ORIGIN is a hardcoded constant, the path must match
// ALLOWLIST exactly, and only the allowlisted query params for that route are forwarded --
// see src/allowlist.ts.
import { buildCoreUrl, resolveRoute, validateQueryParams } from "./allowlist";

// Workers VPC Service binding; optional only so missing deployment configuration fails closed.
export interface VpcServiceBinding {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
}

export interface Env {
  // Configured in wrangler.jsonc; fail safely if a future deployment omits it.
  CORE_VPC?: VpcServiceBinding;
  OPS_WRITE_SECRET?: string;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const route = resolveRoute(url.pathname);
  if (!route) {
    return jsonResponse(404, { error: "NOT_FOUND" });
  }
  if (!(route.methods ?? ["GET"]).includes(request.method)) return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });

  const validation = validateQueryParams(route, url);
  if (!validation.ok) {
    return jsonResponse(400, { error: validation.reason });
  }

  if (!env.CORE_VPC) {
    return jsonResponse(502, { error: "VPC_NOT_CONFIGURED" });
  }

  const targetUrl = buildCoreUrl(route, url);
  try {
    // Deliberately no CF-Access-Client-Id / CF-Access-Client-Secret headers here -- the VPC
    // Service binding authenticates this request at the Cloudflare network layer via the
    // tunnel binding itself, not via a header Core or Access would otherwise need to check.
    if (request.method === "POST" && Number(request.headers.get("content-length") || 0) > 4096)
      return jsonResponse(413, { error: "REQUEST_TOO_LARGE" });
    const body = request.method === "PUT" || request.method === "POST" ? await request.text() : undefined;
    if (request.method === "POST" && body && new TextEncoder().encode(body).length > 4096)
      return jsonResponse(413, { error: "REQUEST_TOO_LARGE" });
    const actorHeaders: Record<string, string> = {};
    if (route.opsWrite) {
      const actor = request.headers.get("X-Ops-User-Id") ?? "";
      const role = request.headers.get("X-Ops-Role") ?? "";
      if (!env.OPS_WRITE_SECRET || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actor) ||
          !["OWNER", "ADMIN", "OPERATOR"].includes(role) || (route.opsWrite === "decision" && role === "OPERATOR"))
        return jsonResponse(403, { error: "UNAUTHORIZED" });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), value => value.toString(16).padStart(2, "0")).join("");
      const encoder = new TextEncoder();
      const bodyHash = hex(await crypto.subtle.digest("SHA-256", encoder.encode(body ?? "")));
      const key = await crypto.subtle.importKey("raw", encoder.encode(env.OPS_WRITE_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const signature = hex(await crypto.subtle.sign("HMAC", key, encoder.encode([request.method, route.upstreamPath, timestamp, actor, role, bodyHash].join("\n"))));
      Object.assign(actorHeaders, { "X-Ops-User-Id": actor, "X-Ops-Role": role, "X-Ops-Timestamp": timestamp, "X-Ops-Signature": signature });
    }
    const response = await env.CORE_VPC.fetch(targetUrl, {
      method: request.method,
      body,
      headers: {
        Accept: route.upstreamPath === "/api/fabric/v1/stream" ? "application/x-ndjson" : "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...actorHeaders,
      },
      signal: request.signal,
    });
    if (!response.ok) console.warn("Core gateway upstream status", route.upstreamPath, response.status);
    return response;
  } catch {
    console.warn("Core gateway transport unavailable", route.upstreamPath);
    // Never surface the underlying exception (which could contain internal network detail) to
    // the caller -- map every VPC transport failure to one generic, safe reason.
    return jsonResponse(502, { error: "CORE_TRANSPORT_UNAVAILABLE" });
  }
}

export default {
  fetch: handleRequest,
};
