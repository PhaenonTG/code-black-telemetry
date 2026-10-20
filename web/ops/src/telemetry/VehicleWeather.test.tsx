import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { FabricUnitState } from "../../../../src/services/fabric/types"
import { VehicleWeather } from "./VehicleWeather"

const now = Date.parse("2026-10-20T08:00:00Z")
const observed = new Date(now - 500).toISOString()
const quality = Object.fromEntries(["wind_mps", "gust_mps", "wind_avg_mps", "wind_direction_deg", "temperature_c", "humidity_pct", "pressure_hpa", "speed_mps", "heading_deg", "trunk_temperature_c"].map(id => [id, { state: "live", observed_at: observed }]))
const unit = {
  unit_id: "cbwx-unit-striker", display_name: "STRIKER", operator_name: "Spencer", unit_type: "chase-platform", role: "chase-platform",
  capabilities: [], overall_health: "LIVE", last_seen: now, metadata: {},
  devices: [
    { device_id: "weather", unit_id: "cbwx-unit-striker", device_type: "esp32-weather", display_label: "STRIKER Weather ESP", capabilities: [], connected: true, health_state: "LIVE", latest: { mesonet: { wind_mps: 8, gust_mps: 10, wind_avg_mps: 7, wind_direction_deg: 238, temperature_c: 22, dewpoint_c: 13, humidity_pct: 57, pressure_hpa: 1008 } }, metadata: { quality, calibration_verified: true } },
    { device_id: "nav", unit_id: "cbwx-unit-striker", device_type: "esp32-navigation", display_label: "STRIKER Navigation ESP", capabilities: [], connected: true, health_state: "LIVE", latest: { mesonet: { speed_mps: 14, heading_deg: 241 } }, metadata: { quality, calibration_verified: true } },
    { device_id: "pi", unit_id: "cbwx-unit-striker", device_type: "raspberry-pi", display_label: "STRIKER Pi", capabilities: [], connected: true, health_state: "LIVE", latest: { mesonet: { trunk_temperature_c: 25 } }, metadata: { quality, calibration_verified: true } },
  ],
} as FabricUnitState

describe("VehicleWeather", () => {
  it("renders the desktop information regions without changing sensor provenance", () => {
    const html = renderToStaticMarkup(<VehicleWeather units={[unit]} selectedId={unit.unit_id} onSelect={() => undefined} receivedAt={now - 300} connected now={now} />)
    expect(html).toContain("Vehicle weather")
    expect(html).toContain("Wind conditions")
    expect(html).toContain("Current conditions")
    expect(html).toContain("Source integrity")
    expect(html).toContain("STRIKER Weather ESP")
    expect(html).toContain("Vehicle observations only. No station fallback.")
    expect(html).toContain("11/11 current")
  })
})
