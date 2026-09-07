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

// The future Workers VPC Service binding. Not created yet -- see README.md. Modeled after the
// documented VPC binding fetch() surface (developers.cloudflare.com/workers-vpc/api/) so the
// real binding can be dropped in later with no code change here.
export interface VpcServiceBinding {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
}

export interface Env {
  // Bound as CORE_VPC once the real Workers VPC Service exists (wrangler.jsonc vpc_services).
  // Deliberately optional: this lets the Worker build, typecheck, and be tested today, and
  // fail safely (502 VPC_NOT_CONFIGURED) rather than crash if ever invoked before the binding
  // is wired up.
  CORE_VPC?: VpcServiceBinding;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
  }

  const url = new URL(request.url);
  const route = resolveRoute(url.pathname);
  if (!route) {
    return jsonResponse(404, { error: "NOT_FOUND" });
  }

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
    return await env.CORE_VPC.fetch(targetUrl, { headers: { Accept: "application/json" } });
  } catch {
    // Never surface the underlying exception (which could contain internal network detail) to
    // the caller -- map every VPC transport failure to one generic, safe reason.
    return jsonResponse(502, { error: "CORE_TRANSPORT_UNAVAILABLE" });
  }
}

export default {
  fetch: handleRequest,
};
