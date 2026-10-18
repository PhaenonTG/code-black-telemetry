// New dedicated origin; never mounts or replaces the existing Core/Producer/private OPS server.
import { originRadarSites } from '../shared/radarSitePolicy.mjs'
import { createServer } from "node:http"
import { stagedPrivateGateway } from "./publicPrivateGateway"
import { resolveParityRoute, sanitizeParityResponse, parityError, privateHeaders } from "../shared/parityContract"

export function createParityOrigin({ env, fetchImpl = fetch, deadlineMs = 11000, maxInflight = 8 }: {
  env: Record<string, string | undefined>; fetchImpl?: typeof fetch; deadlineMs?: number; maxInflight?: number;
}) {
  let active = 0
  const handle = async (request: Request): Promise<Response> => {
    const route = resolveParityRoute(new URL(request.url))
    if (!route || route.site && !originRadarSites(env).includes(route.site) || request.headers.has("Upgrade")) return parityError(404, "ROUTE_NOT_ALLOWED")
    if (request.method !== "GET") return parityError(405, "METHOD_NOT_ALLOWED")
    if (!/^Bearer [^\s]{1,8192}$/.test(request.headers.get("Authorization") ?? "")) return parityError(401, "AUTH_REQUIRED")
    if (active >= maxInflight) return parityError(503, "PARITY_ORIGIN_BUSY")
    const controller = new AbortController(), abort = () => controller.abort()
    request.signal.addEventListener("abort", abort, { once: true }); if (request.signal.aborted) abort()
    const timer = setTimeout(abort, deadlineMs); active++
    let rejectAbort = () => {}
    const cancelled = new Promise<never>((_, reject) => { rejectAbort = () => reject(Error("cancelled")); if (controller.signal.aborted) rejectAbort(); else controller.signal.addEventListener("abort", rejectAbort, { once: true }) })
    let response: Response | undefined
    try {
      const headers = new Headers(), authorization = request.headers.get("Authorization")
      if (authorization) headers.set("Authorization", authorization)
      // Existing reviewed gateway verifies real Supabase user + active recognized role;
      // no identity asserted by the Worker/browser is trusted. Core policy patch stays unapplied.
      response = await Promise.race([stagedPrivateGateway(new Request("https://parity-internal.invalid" + route.path, {
        method: "GET", headers, signal: controller.signal,
      }), env, fetchImpl).then(value => { if (controller.signal.aborted) { void value.body?.cancel().catch(() => {}); throw Error("cancelled") } return value }), cancelled])
      return await Promise.race([sanitizeParityResponse(response, route, controller.signal, originRadarSites(env)), cancelled])
    } catch { return parityError(controller.signal.aborted ? 504 : 502, controller.signal.aborted ? "PARITY_TIMEOUT" : "PARITY_ORIGIN_UNAVAILABLE") }
    finally { clearTimeout(timer); request.signal.removeEventListener("abort", abort); controller.signal.removeEventListener("abort", rejectAbort); controller.abort(); active--; void response?.body?.cancel().catch(() => {}) }
  }
  const server = createServer({ maxHeaderSize: 16384, headersTimeout: 5000, requestTimeout: 12000, keepAliveTimeout: 5000 }, async (incoming, outgoing) => {
    const abort = new AbortController(), cancel = () => abort.abort()
    outgoing.once("close", cancel)
    try {
      const raw = incoming.url ?? ""
      // Reject noncanonical raw paths before URL normalization; ignore untrusted Host/proxy headers.
      if (!raw.startsWith("/api/") || /%|\\|(?:^|\/)\.{1,2}(?:\/|\?|$)/.test(raw) || incoming.headers["transfer-encoding"] || Number(incoming.headers["content-length"] ?? 0) !== 0) {
        outgoing.writeHead(400, { ...privateHeaders, "Content-Type": "application/json", "Connection": "close" })
        outgoing.end('{"error":"PARITY_INVALID_REQUEST"}'); return
      }
      const response = await handle(new Request("https://parity-internal.invalid" + raw, { method: incoming.method,
        headers: incoming.headers as Record<string, string>, signal: abort.signal }))
      if (outgoing.destroyed) { void response.body?.cancel(); return }
      const bytes = new Uint8Array(await response.arrayBuffer())
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(bytes)
    } catch { if (!outgoing.destroyed) { outgoing.writeHead(500, { ...privateHeaders, "Content-Type": "application/json" }); outgoing.end('{"error":"PARITY_ORIGIN_UNAVAILABLE"}') } }
    finally { outgoing.removeListener("close", cancel) }
  })
  server.on("upgrade", (_request, socket) => { socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n") })
  return { handle, server, listen: (port: number) => {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error("Explicit approved origin port required")
    return server.listen(port, "127.0.0.1")
  } }
}
