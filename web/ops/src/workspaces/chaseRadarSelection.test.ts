import { describe, expect, it } from "vitest"
import type { RadarFrame, RadarSite } from "../../../../src/services/radar"
import { loadRadarCandidates, selectRadarFrame } from "./chaseRadarSelection"

const site = (id: string): RadarSite => ({ id, name: id, state: "READY", lat: 39, lon: -95 })
const frame = (id: string, ageSeconds: number, freshness: RadarFrame["freshness"], tiled = true): RadarFrame => ({
  frameId: id, site: site(id), ageSeconds, freshness, tileTemplate: tiled ? `https://example.test/${id}/{z}/{x}/{y}.png` : undefined,
} as RadarFrame)

describe("Chase radar site selection", () => {
  it("prefers a current alternate over a stale nearest site", () => {
    const selected = selectRadarFrame([{ site: site("KAAA"), frames: [frame("old", 1300, "STALE")] }, { site: site("KBBB"), frames: [frame("live", 90, "LIVE")] }])
    expect(selected?.site.id).toBe("KBBB")
  })
  it("retains the freshest stale scan when no site is current", () => {
    const selected = selectRadarFrame([{ site: site("KAAA"), frames: [frame("older", 1800, "STALE")] }, { site: site("KBBB"), frames: [frame("newer", 1400, "STALE")] }])
    expect(selected?.frame.frameId).toBe("newer")
  })
  it("never selects a frame without tiles", () => {
    expect(selectRadarFrame([{ site: site("KAAA"), frames: [frame("not-renderable", 30, "LIVE", false)] }])).toBeNull()
  })
  it("continues to a healthy alternate when the nearest site request fails", async () => {
    const requested: string[] = []
    const results = await loadRadarCandidates([site("KAAA"), site("KBBB"), site("KCCC")], async (candidate) => {
      requested.push(candidate.id)
      if (candidate.id === "KAAA") throw new Error("site unavailable")
      return [frame(candidate.id, 90, "LIVE")]
    })
    expect(requested).toEqual(["KAAA", "KBBB"])
    expect(selectRadarFrame(results)?.site.id).toBe("KBBB")
  })
  it("does not silently substitute a site when the operator explicitly selected one", async () => {
    await expect(loadRadarCandidates([site("KAAA")], async () => { throw new Error("site unavailable") }, true)).rejects.toThrow("site unavailable")
  })
})
