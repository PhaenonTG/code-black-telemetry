// Functional candidate entry selected only in isolated revision 2. No production deployment.
// Production transport/exposure and the separate authorization.patch require approval.
import existingEntry from "./entry"

interface ParityBinding { fetch(request: Request): Promise<Response> }
type ExistingEnv = Parameters<typeof existingEntry.fetch>[1]
type ParityEnv = ExistingEnv & { PRIVATE_PARITY_ORIGIN?: ParityBinding }
const unavailable = (status: number, error: string) => Response.json({ error }, { status, headers: {
  "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Vary": "Authorization",
} })

export default {
  async fetch(request: Request, env: ParityEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    // Producer is deliberately not captured. Its separate zone route remains authoritative.
    const radar = url.pathname.startsWith("/api/ops-radar/v1/")
    const candidate = radar || url.pathname === "/api/coordination/v1/snapshot"
    if (!candidate) return existingEntry.fetch(request, env, ctx)
    if (request.method !== "GET") return unavailable(405, "METHOD_NOT_ALLOWED")
    if (!request.headers.get("Authorization")?.startsWith("Bearer ")) return unavailable(401, "AUTH_REQUIRED")
    if (!env.PRIVATE_PARITY_ORIGIN) return unavailable(503, "PARITY_ORIGIN_NOT_CONFIGURED")
    // A fixed fetch-capable origin transport is injected by the reviewed host. Never accept
    // a browser-supplied host or identity assertion. No production binding is created here.
    const headers = new Headers({ Accept: request.headers.get("Accept") ?? "application/json" })
    headers.set("Authorization", request.headers.get("Authorization")!)
    const abort = new AbortController(), cancel = () => abort.abort()
    request.signal.addEventListener("abort", cancel, { once: true })
    const timer = setTimeout(cancel, 12_000)
    if (request.signal.aborted) cancel()
    try {
      const cancelled = new Promise<never>((_, reject) => {
        if (abort.signal.aborted) reject(Error("cancelled"))
        else abort.signal.addEventListener("abort", () => reject(Error("cancelled")), { once: true })
      })
      const response = await Promise.race([env.PRIVATE_PARITY_ORIGIN.fetch(new Request(
        "https://parity-internal.invalid" + (radar ? url.pathname.replace("/api/ops-radar/v1/", "/api/v1/radar/") : url.pathname) + url.search,
        { method: "GET", headers, signal: abort.signal, redirect: "manual" },
      )), cancelled])
      if (response.status >= 300 && response.status < 400) return unavailable(502, "PARITY_UPSTREAM_REDIRECT")
      return response
    } catch { return unavailable(502, "PARITY_ORIGIN_UNAVAILABLE") }
    finally { clearTimeout(timer); request.signal.removeEventListener("abort", cancel) }
  },
}
