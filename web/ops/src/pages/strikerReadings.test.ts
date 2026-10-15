import { describe, expect, it } from "vitest"
import type { FabricUnitState } from "../../../../src/services/fabric/types"
import { liveChaserReadings } from "./strikerReadings"

const now = Date.parse("2026-10-15T12:00:00Z")
const unit: FabricUnitState = {
  unit_id: "cbwx-unit-striker", display_name: "STRIKER", operator_name: "Spencer",
  unit_type: "chase-platform", role: "chase-platform", capabilities: [],
  overall_health: "LIVE", last_seen: now - 1_000,
  devices: [{
    device_id: "cbwx-striker-weather", unit_id: "cbwx-unit-striker", device_type: "esp32-weather",
    display_label: "Weather", capabilities: [], connected: true, last_seen: now - 1_000,
    latest: { mesonet: { temperature_c: 22.4, humidity_pct: 57, dewpoint_c: 13.5, pressure_hpa: null } },
    metadata: { quality: {
      temperature_c: { state: "live", observed_at: new Date(now - 1_000).toISOString() },
      humidity_pct: { state: "live", observed_at: new Date(now - 1_000).toISOString() },
      pressure_hpa: { state: "unavailable", observed_at: new Date(now - 1_000).toISOString() },
    } },
  }, {
    device_id: "cbwx-striker-nav", unit_id: "cbwx-unit-striker", device_type: "esp32-navigation",
    display_label: "Navigation", capabilities: [], connected: true, last_seen: now - 1_000,
    latest: { mesonet: { wind_hz: 3.2, wind_mps: 6.5 } },
    metadata: { calibration_verified: false, quality: {
      wind_hz: { state: "live", observed_at: new Date(now - 1_000).toISOString() },
      wind_mps: { state: "live", observed_at: new Date(now - 1_000).toISOString() },
    } },
  }],
}

describe("per-chaser live conditions", () => {
  it("shows only valid current values with display units, excluding uncalibrated wind speed", () => {
    expect(liveChaserReadings(unit, now).map((item) => [item.label, item.value])).toEqual([
      ["Temperature", "72.3 °F"], ["Humidity", "57.0%"], ["Dew point", "56.3 °F"], ["Wind pulses", "3.2 Hz"],
    ])
  })

  it("does not carry old or unavailable measurements forward", () => {
    expect(liveChaserReadings(unit, now + 16_000)).toEqual([])
    expect(liveChaserReadings({ ...unit, devices: unit.devices.map((device) => ({ ...device, connected: false })) }, now)).toEqual([])
  })

  it("keeps measurements with their owning chaser", () => {
    expect(liveChaserReadings({ ...unit, unit_id: "cbwx-unit-tessa", operator_name: "Nick", devices: [] }, now)).toEqual([])
  })
})
