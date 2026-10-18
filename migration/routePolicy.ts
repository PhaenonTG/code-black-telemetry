// PROPOSED policy specification for isolated fixtures. Not imported by the production Worker.
// Enabling this policy/exposing these routes requires the coordinator's reviewed approval packet.
export type Identity = { active: boolean; role: string | null; userId: string }
import { resolveAllowlistRoute } from "../web/ops/functions/lib/coreGateway"
import { publicCoreRoleAllowed } from "../web/ops/functions/lib/publicRolePolicy"
const roles = ["OWNER", "ADMIN", "OPERATOR"]
export function proposedPolicy(path: string, method: string, identity: Identity | null): { status: number; policy: string } {
  if (!identity) return { status: 401, policy: "SESSION_REQUIRED" }
  if (!identity.active || !roles.includes(identity.role ?? "")) return { status: 403, policy: "ACTIVE_RECOGNIZED_ROLE_REQUIRED" }
  // Infrastructure/device routes never become public-browser routes in this proposal.
  if (/^\/api\/(producer\/v1\/workstation|mesonet|ops\/admin|coordination\/raw)/.test(path)) return { status: 404, policy: "SERVICE_DEVICE_OR_ADMIN_INGRESS_NOT_EXPOSED" }
  if (path.startsWith("/api/core/")) {
    const route = resolveAllowlistRoute(path.slice("/api/core/".length))
    if (!route) return { status: 404, policy: "CORE_ROUTE_NOT_ALLOWED" }
    if (!(route.methods ?? ["GET"]).includes(method)) return { status: 405, policy: "METHOD_NOT_ALLOWED" }
    if (!publicCoreRoleAllowed(identity.role, path.slice("/api/core/".length), method)) return { status: 403, policy: "OWNER_ADMIN_REQUIRED" }
    return { status: 200, policy: "EXACT_CORE_ALLOWLIST_STILL_REQUIRED" }
  }
  if (path.startsWith("/api/producer/")) return { status: 409, policy: "EXISTING_PRODUCER_POLICY_NOT_REPLACED" }
  if (path === '/api/v1/radar/tracks') return {status:method==='GET'?200:405,policy:'EXACT_RESEARCH_TRACKS_GET_ONLY'}
  if (/^\/api\/v1\/radar\/(frames|frame\/[a-f0-9]{16,64}\/metadata|tiles\/[a-f0-9]{16,64}\/\d{1,2}\/\d{1,7}\/\d{1,7}\.png)$/.test(path)) return { status: method === "GET" ? 200 : 405, policy: "REVIEWED_RADAR_ALLOWLIST_AND_BUDGET_STILL_REQUIRED" }
  if (path === "/api/coordination/v1/snapshot") return { status: method === "GET" ? 200 : 405, policy: "SANITIZED_PROJECTION_ONLY" }
  return { status: 404, policy: "ROUTE_NOT_ALLOWED" }
}
