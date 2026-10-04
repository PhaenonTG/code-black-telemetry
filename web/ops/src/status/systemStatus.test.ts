import { describe, expect, it } from "vitest"
import { buildSystemStatus } from "./systemStatus"
import type { OpsConnectionState } from "../core/types"

function rows(fabricState: OpsConnectionState, unitHealth: Array<"LIVE" | "DEGRADED" | "STALE" | "OFFLINE" | "NOT_CONFIGURED"> | null) {
  const unavailable = { state: "CHECKING" as const, detail: "Checking" }
  return buildSystemStatus({
    coreReachable: true,
    fabric: { state: fabricState, units: unitHealth === null ? null : { units: unitHealth.map((overall_health) => ({ overall_health })) } },
    map: unavailable,
    radar: unavailable,
    singleSiteRadar: unavailable,
    weather: unavailable,
    alerts: unavailable,
  })
}

describe("System status truth", () => {
  it("does not describe a healthy Core API as a vehicle telemetry link", () => {
    expect(rows("LIVE", ["LIVE"]).find((row) => row.key === "core")?.detail).toBe("CodeBlack-Core API reachable")
  })

  it("reports observed live Fabric units instead of a permanent no-data fleet row", () => {
    expect(rows("LIVE", ["LIVE", "OFFLINE"]).find((row) => row.key === "fleet")).toMatchObject({
      state: "LIVE",
      detail: "1 of 2 registered units live",
    })
  })

  it("does not claim live fleet presence from an unavailable Fabric snapshot", () => {
    expect(rows("UNAVAILABLE", ["LIVE"]).find((row) => row.key === "fleet")?.state).toBe("NO_DATA")
    expect(rows("LIVE", ["STALE"]).find((row) => row.key === "fleet")?.state).toBe("STALE")
    expect(rows("LIVE", []).find((row) => row.key === "fleet")?.state).toBe("NO_DATA")
  })
})
