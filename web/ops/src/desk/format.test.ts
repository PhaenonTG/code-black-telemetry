import { describe, expect, it } from "vitest"
import { ageLabel, coordinates, currentAlerts, freshUnitLocation, numberField, distanceMiles, bearing } from "./format"
import { normalizePreferences } from "./preferences"
import type { FabricUnitState } from "../../../../src/services/fabric/types"
import type { AlertProduct } from "../../../../src/services/situational"

describe("desk context integrity", () => {
  it("does not convert missing coordinates or telemetry into zero", () => {
    expect(coordinates({ lat: null, lon: null })).toBeNull()
    expect(coordinates({ lat: 91, lon: -94 })).toBeNull()
    expect(coordinates({ latitude: "36.4", longitude: "-94.2" })).toEqual({ lat: 36.4, lon: -94.2 })
    expect(numberField({ wind: null }, "wind")).toBeNull()
    expect(numberField({ speed: 0 }, "speed")).toBe(0)
  })
  it("excludes stale unit positions from live analysis context", () => {
    const unit: FabricUnitState = { unit_id: "test", display_name: "Test", operator_name: "Test", unit_type: "chase-platform", role: "chase-platform", capabilities: [], devices: [], overall_health: "LIVE", last_seen: 1_000_000, location: { lat: 36, lon: -94 } }
    expect(freshUnitLocation(unit, 1_050_000)).toEqual({ lat: 36, lon: -94 })
    expect(freshUnitLocation(unit, 1_200_000)).toBeNull()
    expect(freshUnitLocation({ ...unit, overall_health: "OFFLINE" }, 1_050_000)).toBeNull()
    expect(freshUnitLocation({ ...unit, last_seen: NaN }, 1_050_000)).toBeNull()
    expect(freshUnitLocation({ ...unit, last_seen: 1_300_000 }, 1_050_000)).toBeNull()
  })
  it("drops expired alerts, deduplicates IDs, and gives official tornado warnings priority", () => {
    const alert = (id: string, severity: AlertProduct["severity"], expires: number) => ({ id, severity, expires: new Date(expires).toISOString(), sent: new Date(0).toISOString() } as AlertProduct)
    expect(currentAlerts([alert("watch", "watch", 5000), alert("tor", "tornado", 5000), alert("tor", "tornado", 5000), alert("old", "pds", 1000)], 2000).map((a) => a.id)).toEqual(["tor", "watch"])
  })
  it("validates persisted modes without dropping existing camera-wall storage", () => {
    expect(normalizePreferences({ workspace: "bad", analysisMode: "bad", unitId: 12 }).workspace).toBe("producer")
    expect(normalizePreferences({ workspace: "analysis", analysisMode: "surveillance" }).analysisMode).toBe("surveillance")
  })
  it("computes point distance and direction without inventing a drive time", () => {
    expect(distanceMiles({ lat: 36, lon: -94 }, { lat: 37, lon: -94 })).toBeCloseTo(69.1, 0)
    expect(bearing({ lat: 36, lon: -94 }, { lat: 37, lon: -94 })).toBe("0° N")
  })
  it("does not label a future source timestamp as freshly observed", () => {
    expect(ageLabel(300_000, 100_000)).toBe("Clock mismatch")
    expect(ageLabel(null, 100_000)).toBe("Time unknown")
    expect(ageLabel(90_000, 100_000)).toBe("Just now")
  })
})
