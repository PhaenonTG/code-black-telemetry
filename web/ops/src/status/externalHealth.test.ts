import { describe, expect, it } from "vitest"
import { interpretRadarStatus } from "./externalHealth"

describe("single-site radar data freshness", () => {
  it("does not call a reachable worker live without a frame", () => {
    expect(interpretRadarStatus({ backendState: "DEGRADED", dataAgeSeconds: null }).state).toBe("NO_DATA")
  })

  it("ages and stales old frames", () => {
    expect(interpretRadarStatus({ backendState: "READY", selectedSite: "KSRX", dataAgeSeconds: 700 }).state).toBe("AGING")
    expect(interpretRadarStatus({ backendState: "READY", selectedSite: "KSRX", dataAgeSeconds: 1100 }).state).toBe("STALE")
  })

  it("reports fresh reflectivity frames as live", () => {
    expect(interpretRadarStatus({ backendState: "READY", selectedSite: "KSRX", dataAgeSeconds: 300 })).toEqual({
      state: "LIVE", detail: "KSRX reflectivity frame 5m old",
    })
  })
})
