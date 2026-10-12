import { describe, expect, it } from "vitest"
import { assessmentIsStale, fleetContextMatches, rememberReview, reviewMatchesPoint, reviewPointKey, type PointReviews } from "./aegisReview"
import type { TargetAiAnalysis } from "../localAiAdvisory"
const now = Date.parse("2026-10-12T12:00:00Z")
const review: TargetAiAnalysis = { status: "available", generated_at: new Date(now - 60_000).toISOString(), context: { context_type: "SELECTED_TARGET", latitude: 36, longitude: -94 }, radar_evidence: {} }
describe("Context-safe Aegis reviews", () => {
  it("never rounds distinct points into the same briefing", () => {
    expect(reviewPointKey({ lat: 36, lon: -94 })).not.toBe(reviewPointKey({ lat: 36.000001, lon: -94 }))
    expect(reviewMatchesPoint(review, { lat: 36, lon: -94 })).toBe(true)
    expect(reviewMatchesPoint(review, { lat: 36.000001, lon: -94 })).toBe(false)
    expect(reviewPointKey({ lat: NaN, lon: 0 })).toBe("")
  })
  it("ages the model result, not the latest GET wrapper", () => {
    expect(assessmentIsStale(review, now)).toBe(false)
    expect(assessmentIsStale({ ...review, generated_at: new Date(now - 600_000).toISOString() }, now)).toBe(true)
    expect(assessmentIsStale({ ...review, generated_at: new Date(now + 61_000).toISOString() }, now)).toBe(true)
    expect(assessmentIsStale({ status: "available", generated_at: new Date(now).toISOString(), assessment_generated_at: new Date(now - 601_000).toISOString() }, now)).toBe(true)
    expect(assessmentIsStale({ status: "available", generated_at: new Date(now).toISOString() }, now)).toBe(true)
  })
  it("does not present a default-unit result as a selected-unit result", () => {
    const ai = { status: "available" as const, generated_at: "", context: { unit_id: "tessa", context_type: "AT_UNIT" } }
    expect(fleetContextMatches(ai, "striker")).toBe(false)
    expect(fleetContextMatches(ai, "tessa")).toBe(true)
  })
  it("retains at most twelve exact-point results without mutating history", () => {
    let history: PointReviews = {}
    for (let index = 0; index < 15; index++) history = rememberReview(history, String(index), { value: review, error: "", requestedAt: index, selection: { point: { lat: index, lon: 0 }, label: "Map point" } })
    expect(Object.keys(history)).toHaveLength(12)
    expect(history["0"]).toBeUndefined()
    const next = rememberReview(history, "new", { value: null, error: "Failed", requestedAt: 20, selection: { point: { lat: 80, lon: 0 }, label: "Map point" } })
    expect(history.new).toBeUndefined()
    expect(next.new.error).toBe("Failed")
  })
})
