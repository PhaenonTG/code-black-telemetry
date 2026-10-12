import { describe, expect, it } from "vitest"
import { fabricStateFromSnapshot } from "./fabricSnapshot"
import { freshUnitLocation } from "../desk/format"

const at = "2026-10-12T08:34:57.366000Z"
const snapshot = (lastSeen: unknown = at) => ({ schema: "codeblack.fabric.unit-state", schema_version: "1.0.0", generated_at: at, units: [{ unit_id: "cbwx-unit-striker", display_name: "Striker", operator_name: "Glenn", unit_type: "chase-platform", role: "chase-platform", capabilities: [], overall_health: "LIVE", last_seen: lastSeen, location: { lat: 36.4, lon: -94.2 }, devices: [{ device_id: "cbwx-striker-pi", last_seen: at }] }], transports: {} })

describe("Fabric wire timestamp normalization", () => {
  it("normalizes real Core ISO clocks at both unit and device level", () => {
    const result = fabricStateFromSnapshot(snapshot())!
    expect(result.generated_at).toBe(Date.parse(at))
    expect(result.units[0].last_seen).toBe(Date.parse(at))
    expect(result.units[0].devices[0].last_seen).toBe(Date.parse(at))
    expect(freshUnitLocation(result.units[0], Date.parse(at) + 10_000)).toEqual({ lat: 36.4, lon: -94.2 })
    expect(freshUnitLocation(result.units[0], Date.parse(at) + 130_000)).toBeNull()
  })
  it("preserves epoch-ms snapshots and does not mutate a received payload", () => {
    const input = snapshot(Date.parse(at))
    const result = fabricStateFromSnapshot({ ...input, generated_at: Date.parse(at) })!
    expect(result.units[0].last_seen).toBe(Date.parse(at))
    expect(input.units[0].devices[0].last_seen).toBe(at)
  })
  it("keeps invalid, missing and timezone-ambiguous last-seen values unknown", () => {
    for (const value of [null, undefined, "", "2026-10-12T08:34:57", "bad", false, NaN]) {
      const input = snapshot()
      input.units[0].last_seen = value
      const result = fabricStateFromSnapshot(input)!
      expect(result.units[0].last_seen).toBeNull()
      expect(freshUnitLocation(result.units[0], Date.parse(at))).toBeNull()
    }
  })
  it("rejects an invalid snapshot clock or malformed unit list", () => {
    expect(fabricStateFromSnapshot({ ...snapshot(), generated_at: "bad" })).toBeNull()
    expect(fabricStateFromSnapshot({ ...snapshot(), units: [null] })).toBeNull()
    expect(fabricStateFromSnapshot({ ...snapshot(), units: [{ unit_id: "test" }] })).toBeNull()
  })
})
