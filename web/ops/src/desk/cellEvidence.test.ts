import { describe, expect, it } from "vitest"
import type { AegisObservationPlan } from "../aegisObservation"
import { appendCellSample, cellEvidence } from "./cellEvidence"
const now = Date.parse("2026-10-12T12:00:00Z"), observed = new Date(now - 120_000).toISOString()
const plan: Pick<AegisObservationPlan, "radar"> = { radar: { available: true, updated_at: observed, products: { REF: { available: true, trustworthy: true, freshness_state: "LIVE", site_id: "KSRX", observed_at: observed } }, dominant_cell: { id: "KSRX-primary", available: true, site_id: null, location: { lat: 35.2, lon: -94.3 }, max_dbz: 44, speed_knots: 20, direction_degrees: 45, confidence: "MEDIUM", sample_span_minutes: 5, observed_at: observed, freshness_state: "LIVE", trustworthy: true } } }
describe("Dominant-echo evidence", () => {
  it("resolves Core's null cell site only from unambiguous product provenance", () => {
    const result = cellEvidence(plan, now)
    expect(result.fresh).toBe(true)
    expect(result.sample).toMatchObject({ site: "KSRX", trusted: true, point: { lat: 35.2, lon: -94.3 } })
  })
  it("requires trusted REF scan-pair evidence even when the worker cell says trusted", () => {
    const copy = structuredClone(plan); copy.radar.products!.REF.trustworthy = false
    expect(cellEvidence(copy, now).sample?.trusted).toBe(false)
    copy.radar.products!.REF.trustworthy = true; copy.radar.dominant_cell!.sample_span_minutes = null
    expect(cellEvidence(copy, now).sample?.trusted).toBe(false)
  })
  it("rejects missing/invalid positions and ambiguous sites", () => {
    for (const location of [null, { lat: 91, lon: 0 }, { lat: null, lon: null }]) {
      const copy = structuredClone(plan); copy.radar.dominant_cell!.location = location as never
      expect(cellEvidence(copy, now).sample).toBeNull()
    }
    const copy = structuredClone(plan); copy.radar.products!.VEL = { available: true, site_id: "KTLX" }
    expect(cellEvidence(copy, now).sample).toBeNull()
  })
  it("expires cells using observation time, future clocks and failed sources", () => {
    expect(cellEvidence(plan, now + 18 * 60_000).fresh).toBe(false)
    expect(cellEvidence(plan, now - 4 * 60_000).fresh).toBe(false)
    expect(cellEvidence(plan, now, true).fresh).toBe(false)
    const copy = structuredClone(plan); copy.radar.dominant_cell!.available = false
    expect(cellEvidence(copy, now).sample).toBeNull()
  })
  it("keeps unique bounded session samples, not fabricated cell identities or trails", () => {
    const sample = cellEvidence(plan, now).sample!
    expect(appendCellSample([sample], sample, now)).toHaveLength(1)
    expect(appendCellSample([sample], null, now + 31 * 60_000)).toHaveLength(0)
    let history = [sample]
    for (let index = 1; index <= 30; index++) history = appendCellSample(history, { ...sample, observedAt: new Date(now - 120_000 + index * 1000).toISOString() }, now)
    expect(history).toHaveLength(24)
  })
})
