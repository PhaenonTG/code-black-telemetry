// Isolated origin candidate. No production transport connects it; r19 service is unchanged.
// Current public Core/Fabric routing stays on its existing pipeline; only reviewed private
// Producer/radar paths are candidates for this adapter after exposure-policy approval.
import { verifyOpsAuth } from "../web/ops/functions/lib/coreGateway"
import { proposedPolicy } from "./routePolicy"
import { readApprovedCoordination } from "./coordinationSnapshot"
// Selected-site candidate retains the private read bounds; the frozen r19 copy stays unchanged.
// @ts-ignore Frozen runtime's JS exports are verified by fixture execution/member hashes.
import { handlePrivateRadarRequest } from "./selectedSiteRadarGateway.mjs"

const reply = (status: number, error: string) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } })
export async function stagedPrivateGateway(request: Request, env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url)
  // Never downgrade the complete Producer surface through the limited r19 OBS adapter.
  if (url.pathname.startsWith("/api/producer/")) return reply(404, "PRODUCER_REMAINS_ON_EXISTING_WORKER")
  if (!url.pathname.startsWith("/api/v1/radar/") && url.pathname !== "/api/coordination/v1/snapshot") return reply(404, "ROUTE_NOT_ALLOWED")
  if (/\/workstation\//.test(url.pathname)) return reply(404, "DEVICE_INGRESS_NOT_EXPOSED")
  const controller = new AbortController()
  const cancel = () => controller.abort()
  request.signal.addEventListener("abort", cancel, { once: true })
  const timer = setTimeout(cancel, 6_000)
  if (request.signal.aborted) controller.abort()
  let auth
  try {
    if (controller.signal.aborted) return reply(499, "REQUEST_CANCELLED")
    const failed = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("auth deadline")), { once: true }))
    const boundedFetch = ((input, init) => fetchImpl(input, { ...init, signal: controller.signal })) as typeof fetch
    auth = await Promise.race([verifyOpsAuth(request.headers.get("Authorization"), env, boundedFetch), failed])
  } catch { return reply(502, "AUTH_PROVIDER_UNAVAILABLE") }
  finally { clearTimeout(timer); request.signal.removeEventListener("abort", cancel) }
  if (!auth.ok) return reply(auth.status, auth.reason)
  const decision = proposedPolicy(url.pathname, request.method, { active: true, userId: auth.userId, role: auth.role })
  if (decision.status !== 200) return reply(decision.status, decision.policy)
  if (url.pathname === "/api/coordination/v1/snapshot") {
    if (url.search) return reply(404, "ROUTE_NOT_ALLOWED")
    return readApprovedCoordination(env)
  }
  const headers = new Headers(request.headers)
  for (const name of [...headers.keys()]) if (/^x-(ops|producer)-/i.test(name) || /^cf-access-/i.test(name)) headers.delete(name)
  return handlePrivateRadarRequest(new Request(request, { headers }), env, fetchImpl)
}
