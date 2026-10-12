import { describe, expect, it } from "vitest"
import { radarEvidenceStatus } from "./radarEvidence"

const now = Date.parse("2026-10-12T08:38:00Z")
const radar = { available: true, updated_at: "2026-10-12T08:37:59Z", products: { REF: { available: true, trustworthy: false, freshness_state: "LIVE" } } }
describe("radar source-health honesty", () => {
  it("does not turn green merely because a fresh frame with gaps exists", () => expect(radarEvidenceStatus(radar, false, now)).toBe("warn"))
  it("requires at least one explicitly trustworthy, fresh product", () => expect(radarEvidenceStatus({ ...radar, products: { REF: { available: true, trustworthy: true, freshness_state: "LIVE" } } }, false, now)).toBe("ok"))
  it("does not hide an old product behind a recently refreshed envelope", () => {
    for (const freshness_state of [undefined, "STALE", "CACHED", "DELAYED", "OFFLINE", "INCOMPLETE"]) expect(radarEvidenceStatus({ ...radar, products: { REF: { available: true, trustworthy: true, freshness_state } } }, false, now)).toBe("warn")
  })
  it("keeps failed, stale, unknown and future-clock evidence out of the ready state", () => {
    expect(radarEvidenceStatus({ ...radar, products: { REF: { available: true, trustworthy: true } } }, true, now)).toBe("warn")
    for (const updated_at of [undefined, "bad", "2026-10-12T08:10:00Z", "2026-10-12T08:40:00Z"]) expect(radarEvidenceStatus({ ...radar, updated_at }, false, now)).toBe("warn")
    expect(radarEvidenceStatus(null, false, now)).toBe("off")
  })
})
