import { radarSitePattern } from './radarSitePolicy.mjs'
import { projectTrackingResearch } from './trackingResearchContract.mjs'
import { validateCoordination } from "../web/ops/src/status/coordination/contract"

export type ParityRoute = { kind: "frames" | "metadata" | "tile" | "coordination" | "tracks"; path: string; site?: string; product?: string; cut?: number; frameId?: string }
export const privateHeaders = { "Cache-Control": "private, no-store", "Vary": "Authorization", "X-Content-Type-Options": "nosniff" }
export const parityError = (status: number, error: string) => Response.json({ error }, { status, headers: privateHeaders })

export function resolveParityRoute(url: URL): ParityRoute | null {
  if (url.username || url.password || url.hash || /%|\\/.test(url.pathname)) return null
  if (url.pathname === "/api/coordination/v1/snapshot") return url.search ? null : { kind: "coordination", path: url.pathname }
  if (url.pathname === '/api/v1/radar/tracks') {
    const keys=[...url.searchParams.keys()];
    if(keys.length!==3||new Set(keys).size!==3||keys.some(key=>!['site','product','tilt'].includes(key))||url.searchParams.get('site')!=='KSRX'||url.searchParams.get('product')!=='REF'||url.searchParams.get('tilt')!=='1')return null
    return {kind:'tracks',path:'/api/v1/radar/tracks?site=KSRX&product=REF&tilt=1',site:'KSRX',product:'REF',cut:1}
  }
  const metadata = url.pathname.match(/^\/api\/v1\/radar\/frame\/([a-f0-9]{16,64})\/metadata$/)
  if (metadata) return url.search ? null : { kind: "metadata", path: url.pathname, frameId: metadata[1] }
  const tile = url.pathname.match(/^\/api\/v1\/radar\/tiles\/([a-f0-9]{16,64})\/(0|[1-9]\d?)\/(0|[1-9]\d{0,6})\/(0|[1-9]\d{0,6})\.png$/)
  if (tile) {
    const [z, x, y] = tile.slice(2).map(Number)
    return !url.search && z <= 16 && x < 2 ** z && y < 2 ** z ? { kind: "tile", path: url.pathname, frameId: tile[1] } : null
  }
  if (url.pathname !== "/api/v1/radar/frames") return null
  const keys = [...url.searchParams.keys()], product = url.searchParams.get("product"), cut = product === "VEL" ? 2 : 1
  if (keys.length !== 4 || new Set(keys).size !== 4 || keys.some(k => !["site", "product", "tilt", "limit"].includes(k)) ||
    !radarSitePattern.test(url.searchParams.get("site") ?? "") || !["REF", "VEL", "CC"].includes(product ?? "") ||
    url.searchParams.get("tilt") !== String(cut) || url.searchParams.get("limit") !== "1") return null
  const query = new URLSearchParams({ site: url.searchParams.get("site")!, product: product!, tilt: String(cut), limit: "1" })
  return { kind: "frames", path: url.pathname + "?" + query, site: url.searchParams.get("site")!, product: product!, cut }
}

function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("schema")
  return value as Record<string, any>
}
function finite(value: unknown, min = -Infinity, max = Infinity): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw Error("schema")
  return value
}
function label(value: unknown): string {
  if (typeof value !== "string" || value.length > 160 || !/^[A-Za-z0-9 .,:()_+\-]*$/.test(value)) throw Error("schema")
  return value
}
/** Curated render/provenance schema; unknown URLs, paths, tokens and extra fields are never returned. */
export function projectRadarFrame(value: unknown, route: ParityRoute): Record<string, unknown> {
  const f = object(value), site = object(f.site), legend = object(f.legend)
  if (typeof f.frameId !== "string" || !/^[a-f0-9]{16,64}$/.test(f.frameId) || typeof site.id !== "string" || !radarSitePattern.test(site.id) || (route.site && site.id !== route.site) || !["REF", "VEL", "CC"].includes(f.product) ||
    f.tilt !== (f.product === "VEL" ? 2 : 1) || typeof f.time !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(f.time) || !Number.isFinite(Date.parse(f.time)) ||
    !["LIVE", "DELAYED", "STALE", "CACHED", "INCOMPLETE"].includes(f.freshness) ||
    (route.frameId && f.frameId !== route.frameId) || (route.product && (f.product !== route.product || f.tilt !== route.cut))) throw Error("schema")
  const units = { REF: "dBZ", VEL: "kt", CC: "rho-hv" }[f.product as "REF" | "VEL" | "CC"]
  if (legend.kind !== "linear" || legend.units !== units || !Array.isArray(legend.colorStops) || legend.colorStops.length < 2 || legend.colorStops.length > 64) throw Error("schema")
  const stops = legend.colorStops.map((stop: unknown, i: number) => {
    if (!Array.isArray(stop) || stop.length !== 2 || !Array.isArray(stop[1]) || stop[1].length !== 3) throw Error("schema")
    const v = finite(stop[0]); if (i && v <= legend.colorStops[i - 1][0]) throw Error("schema")
    return [v, stop[1].map((c: unknown) => { const n = finite(c, 0, 255); if (!Number.isInteger(n)) throw Error("schema"); return n })]
  })
  const publicSite: Record<string, unknown> = { id: site.id }
  for (const key of ["name", "state"]) if (site[key] !== undefined) publicSite[key] = label(site[key])
  for (const [key, min, max] of [["lat", -90, 90], ["lon", -180, 180], ["distanceMi", 0, Infinity]] as const) if (site[key] !== undefined) publicSite[key] = finite(site[key], min, max)
  const result: Record<string, unknown> = { frameId: f.frameId, site: publicSite, product: f.product, tilt: f.tilt, time: f.time,
    ageSeconds: finite(f.ageSeconds, 0), freshness: f.freshness, legend: { kind: "linear", units, colorStops: stops } }
  for (const key of ["sourceLevel", "quality"]) if (f[key] !== undefined) result[key] = label(f[key])
  for (const key of ["elevationAngle", "vcp", "nyquistVelocity", "processingDurationMs", "chunkVolume", "chunkCount", "radialCount", "maxAzimuthGapDeg"]) if (f[key] !== undefined) result[key] = f[key] === null ? null : finite(f[key])
  for (const key of ["trustworthy", "chunkComplete"]) if (f[key] !== undefined) { if (typeof f[key] !== "boolean") throw Error("schema"); result[key] = f[key] }
  if (f.availableTilts !== undefined) { if (!Array.isArray(f.availableTilts) || f.availableTilts.length > 32) throw Error("schema"); result.availableTilts = f.availableTilts.map((n: unknown) => finite(n, 0, 32)) }
  if (f.bounds !== undefined) { const b = object(f.bounds); const bounds = { west: finite(b.west, -180, 180), east: finite(b.east, -180, 180), south: finite(b.south, -90, 90), north: finite(b.north, -90, 90) }; if (bounds.west >= bounds.east || bounds.south >= bounds.north) throw Error("schema"); result.bounds = bounds }
  return result
}

/** Fully consumes/caps before returning; excludes redirects, cookies, arbitrary headers and private error text. */
export async function sanitizeParityResponse(response: Response, route: ParityRoute, signal?: AbortSignal, allowedSites?: string[]): Promise<Response> {
  const max = route.kind === "tile" && response.status === 200 ? 1048576 : route.kind === "coordination" ? 262144 : 131072
  const reader = response.body?.getReader(); let size = 0
  const chunks: Uint8Array[] = []
  const abort = () => { void reader?.cancel().catch(() => {}) }
  let rejectAbort = () => {}
  signal?.addEventListener("abort", abort, { once: true })
  try {
    if (signal?.aborted || Number(response.headers.get("Content-Length") ?? 0) > max || response.status >= 300 && response.status < 400) throw Error("response")
    const cancelled = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(Error("cancelled"))
      if (signal?.aborted) rejectAbort()
      else signal?.addEventListener("abort", rejectAbort, { once: true })
    })
    if (reader) while (true) { const item = await Promise.race([reader.read(), cancelled]); if (item.done) break; size += item.value.byteLength; if (size > max) throw Error("size"); chunks.push(item.value) }
    const bytes = new Uint8Array(size); let at = 0; for (const c of chunks) { bytes.set(c, at); at += c.length }
    const type = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase()
    if (route.kind === "tile" && response.status === 200) {
      if (type !== "image/png" || size < 8 || ![137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) throw Error("png")
      return new Response(bytes, { headers: { ...privateHeaders, "Content-Type": "image/png" } })
    }
    if (type !== "application/json") throw Error("json")
    const data = JSON.parse(new TextDecoder().decode(bytes))
    if (response.status !== 200) {
      if (![400,401,403,404,405,413,422,429,499,500,502,503,504].includes(response.status)) throw Error("status")
      const code = data?.error ?? data?.reason
      const allowed = ["AUTH_REQUIRED","AUTH_INVALID","UNAUTHORIZED","AUTH_PROVIDER_UNAVAILABLE","GATEWAY_MISCONFIGURED","REQUEST_CANCELLED","RADAR_NOT_CONFIGURED","RADAR_ROUTE_NOT_ALLOWED","RADAR_GATEWAY_BUSY","RADAR_UPSTREAM_REDIRECT","RADAR_UNAVAILABLE","RADAR_INVALID_RESPONSE","RADAR_RESPONSE_TOO_LARGE","RADAR_TIMEOUT","COORDINATION_UNAVAILABLE","FRAME_PENDING","ACTIVE_RECOGNIZED_ROLE_REQUIRED","SESSION_REQUIRED","METHOD_NOT_ALLOWED","ROUTE_NOT_ALLOWED","PARITY_ORIGIN_BUSY","PARITY_TIMEOUT","PARITY_INVALID_UPSTREAM"]
      const safe = typeof code === "string" && allowed.includes(code) ? code : "PARITY_UPSTREAM_UNAVAILABLE"
      return Response.json({ error: safe, reason: safe }, { status: response.status, headers: { ...privateHeaders, ...(response.status === 503 ? { "Retry-After": "2" } : {}) } })
    }
    const projected = route.kind === "tracks" ? (() => {if(allowedSites&&!allowedSites.includes('KSRX'))throw Error('site');return projectTrackingResearch(data)})() : route.kind === "coordination" ? validateCoordination(data) : route.kind === "frames" ? (() => {
      if (!Array.isArray(data) || data.length > 1 || allowedSites && data.some(frame => !allowedSites.includes(frame?.site?.id))) throw Error("frames")
      return data.map(frame => projectRadarFrame(frame, route))
    })() : (() => { if (allowedSites && !allowedSites.includes(data?.site?.id)) throw Error("site"); return projectRadarFrame(data, route) })()
    return Response.json(projected, { headers: privateHeaders })
  } catch { return parityError(signal?.aborted ? 504 : 502, signal?.aborted ? "PARITY_TIMEOUT" : "PARITY_INVALID_UPSTREAM") }
  finally { signal?.removeEventListener("abort", abort); signal?.removeEventListener("abort", rejectAbort); void reader?.cancel().catch(() => {}); try { reader?.releaseLock() } catch {} }
}
