import type { AegisObservationPlan } from "../aegisObservation"
import { validPoint } from "../localAiAdvisory"
import type { Point } from "./format"

export type CellSample = { id: string; site: string; point: Point; observedAt: string; maxDbz: number | null; speedKnots: number | null; directionDegrees: number | null; confidence: string; sampleSpanMinutes: number | null; trusted: boolean }
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
const live = (value: unknown) => typeof value === "string" && /^(LIVE|FRESH)$/i.test(value)
export function cellEvidence(plan: Pick<AegisObservationPlan, "radar"> | null, now: number, sourceFailed = false) {
  const radar = plan?.radar, cell = radar?.dominant_cell
  if (!radar || !cell || cell.available !== true) return { sample: null, fresh: false, reason: cell?.last_error || "No dominant-echo estimate published." }
  const products = Object.values(radar.products ?? {}).filter((value) => value?.available === true)
  const sites = [...new Set(products.map((value) => value.site_id).filter((value): value is string => typeof value === "string" && /^K[A-Z0-9]{3}$/.test(value)))]
  const site = typeof cell.site_id === "string" && /^K[A-Z0-9]{3}$/.test(cell.site_id) ? cell.site_id : sites.length === 1 ? sites[0] : ""
  const point = cell.location
  if (!site || !validPoint(point as Point) || !cell.observed_at || !cell.id) return { sample: null, fresh: false, reason: "Cell location, radar site, identity or observation time missing." }
  const age = now - Date.parse(cell.observed_at), envelopeAge = radar.updated_at ? now - Date.parse(radar.updated_at) : Infinity
  const fresh = !sourceFailed && Number.isFinite(age) && age >= -60_000 && age < 18 * 60_000 && envelopeAge >= -60_000 && envelopeAge < 18 * 60_000 && live(cell.freshness_state)
  const ref = radar.products?.REF
  const refAge = ref?.observed_at ? now - Date.parse(ref.observed_at) : Infinity
  const trusted = fresh && cell.trustworthy === true && ref?.available === true && ref.trustworthy === true && ref.site_id === site && live(ref.freshness_state) && refAge >= -60_000 && refAge < 18 * 60_000 && finite(cell.sample_span_minutes) && cell.sample_span_minutes > 0
  const sample: CellSample = { id: cell.id, site, point: { lat: point!.lat!, lon: point!.lon! }, observedAt: cell.observed_at,
    maxDbz: finite(cell.max_dbz) ? cell.max_dbz : null,
    speedKnots: finite(cell.speed_knots) && cell.speed_knots >= 0 ? cell.speed_knots : null,
    directionDegrees: finite(cell.direction_degrees) && cell.direction_degrees >= 0 && cell.direction_degrees < 360 ? cell.direction_degrees : null,
    confidence: typeof cell.confidence === "string" ? cell.confidence : "Unknown", sampleSpanMinutes: finite(cell.sample_span_minutes) ? cell.sample_span_minutes : null, trusted }
  return { sample, fresh, reason: sourceFailed ? "Source check failed." : !fresh ? "Stale or incomplete observation timing." : !trusted ? "REF coverage or scan-pair evidence needs review." : "" }
}
export function appendCellSample(history: CellSample[], sample: CellSample | null, now: number): CellSample[] {
  const kept = history.filter((row) => now - Date.parse(row.observedAt) < 30 * 60_000 && Date.parse(row.observedAt) <= now + 60_000)
  if (!sample || kept.some((row) => row.site === sample.site && row.id === sample.id && row.observedAt === sample.observedAt)) return kept
  return [...kept, sample].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt)).slice(-24)
}
