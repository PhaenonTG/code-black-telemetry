import { describe, expect, it } from "vitest"
import type { FabricDeviceState } from "../../../../src/services/fabric/types"
import { formatStrikerReading, strikerReading } from "./strikerReadings"

const now = Date.parse("2026-10-15T12:00:00Z")
const device = {
  device_id: "cbwx-striker-weather", unit_id: "cbwx-unit-striker", device_type: "esp32-weather",
  display_label: "Weather", capabilities: [], connected: true, last_seen: now - 1_000,
  latest: { mesonet: { temperature_c: 22.4, humidity_pct: 57, dewpoint_c: 13.5 } },
  metadata: { quality: {
    temperature_c: { state: "live", observed_at: new Date(now - 1_000).toISOString() },
    humidity_pct: { state: "live", observed_at: new Date(now - 1_000).toISOString() },
  } },
} satisfies FabricDeviceState

describe("Striker ESP readings", () => {
  it("uses familiar display units without changing Core's source values", () => {
    expect(formatStrikerReading("temperature_c", 0)).toBe("32.0 °F")
    expect(formatStrikerReading("dewpoint_c", 20)).toBe("68.0 °F")
    expect(formatStrikerReading("pressure_hpa", 1013.25)).toBe("29.92 inHg")
    expect(formatStrikerReading("speed_mps", 10)).toBe("22.4 mph")
    expect(formatStrikerReading("wind_hz", 2)).toBe("2.0 Hz")
    expect(formatStrikerReading("temperature_c", null)).toBe("—")
  })
  it("shows accepted live values and expires them using sensor timestamps", () => {
    expect(strikerReading(device, "temperature_c", now)).toBe(22.4)
    expect(strikerReading(device, "dewpoint_c", now)).toBe(13.5)
    expect(strikerReading(device, "temperature_c", now + 3_100)).toBeNull()
  })

  it("does not show a value when the sensor is unavailable or the report is old", () => {
    expect(strikerReading({ ...device, metadata: { quality: { temperature_c: { state: "unavailable", observed_at: new Date(now).toISOString() } } } }, "temperature_c", now)).toBeNull()
    expect(strikerReading({ ...device, last_seen: now - 6_000 }, "temperature_c", now)).toBeNull()
    expect(strikerReading({ ...device, connected: false }, "temperature_c", now)).toBeNull()
  })
})
