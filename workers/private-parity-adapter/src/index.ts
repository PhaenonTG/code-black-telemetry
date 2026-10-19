import { resolveParityRoute, sanitizeParityResponse, parityError } from "../../../shared/parityContract"

export interface ParityAdapterEnv { PARITY_VPC?: { fetch(input: string | URL, init?: RequestInit): Promise<Response> } }
export function createParityAdapter({ deadlineMs = 11500, maxInflight = 8 } = {}) {
  let active = 0
  return async (request: Request, env: ParityAdapterEnv): Promise<Response> => {
    const url = new URL(request.url), route = resolveParityRoute(url)
    if (url.origin !== "https://parity-internal.invalid" || !route || request.headers.has("Upgrade")) return parityError(404, "ROUTE_NOT_ALLOWED")
    if (request.method !== "GET") return parityError(405, "METHOD_NOT_ALLOWED")
    const authorization = request.headers.get("Authorization") ?? ""
    if (!/^Bearer [^\s]{1,8192}$/.test(authorization)) return parityError(401, "AUTH_REQUIRED")
    if (!env.PARITY_VPC) return parityError(503, "PARITY_VPC_NOT_CONFIGURED")
    if (active >= maxInflight) return parityError(503, "PARITY_ADAPTER_BUSY")
    const controller = new AbortController(), abort = () => controller.abort()
    request.signal.addEventListener("abort", abort, { once: true })
    if (request.signal.aborted) abort()
    const timer = setTimeout(abort, deadlineMs); active++
    let response: Response | undefined
    let rejectAbort = () => {}
    const cancelled = new Promise<never>((_, reject) => { rejectAbort = () => reject(Error("cancelled")); if (controller.signal.aborted) rejectAbort(); else controller.signal.addEventListener("abort", rejectAbort, { once: true }) })
    try {
      // PARITY_VPC is a NEW proposed loopback service on the existing tunnel; never the
      // existing Core API binding. The configured VPC target owns address/port selection.
      response = await Promise.race([env.PARITY_VPC.fetch("http://parity-origin.internal" + route.path, {
        method: "GET", headers: { Authorization: authorization, Accept: route.kind === "tile" ? "image/png" : "application/json" },
        redirect: "manual", signal: controller.signal,
      }).then(value => { if (controller.signal.aborted) { void value.body?.cancel().catch(() => {}); throw Error("cancelled") } return value }), cancelled])
      return await Promise.race([sanitizeParityResponse(response, route, controller.signal), cancelled])
    } catch { return parityError(controller.signal.aborted ? 504 : 502, controller.signal.aborted ? "PARITY_TIMEOUT" : "PARITY_ORIGIN_UNAVAILABLE") }
    finally { clearTimeout(timer); request.signal.removeEventListener("abort", abort); controller.signal.removeEventListener("abort", rejectAbort); controller.abort(); active--; void response?.body?.cancel().catch(() => {}) }
  }
}
const fetchParity = createParityAdapter()
export default { fetch: fetchParity }
