import type { FabricDeviceState, FabricNormalizedState } from "../../../../src/services/fabric/types"

export const STRIKER_SENSORS = [
  { id: "cbwx-striker-weather", title: "Weather ESP", fields: [
    { key: "temperature_c", label: "Temperature" },
    { key: "humidity_pct", label: "Humidity" },
    { key: "dewpoint_c", label: "Dew point" },
  ] },
  { id: "cbwx-striker-nav", title: "Vane / Nav ESP", fields: [
    { key: "wind_hz", label: "Wind pulses" },
    { key: "wind_direction_deg", label: "Wind direction" },
    { key: "trunk_temperature_c", label: "BME280 temperature" },
    { key: "pressure_hpa", label: "Pressure" },
    { key: "speed_mps", label: "GPS speed" },
    { key: "heading_deg", label: "GPS heading" },
    { key: "latitude", label: "Latitude" },
    { key: "longitude", label: "Longitude" },
  ] },
] as const

function timestamp(value: unknown): number | null {
  const time = typeof value === "string" ? Date.parse(value)
    : typeof value === "number" ? (value < 100_000_000_000 ? value * 1000 : value) : NaN
  return Number.isFinite(time) && time > 0 ? time : null
}

export function strikerDevice(snapshot: FabricNormalizedState | null, id: string): FabricDeviceState | null {
  return snapshot?.units.find((unit) => unit.unit_id === "cbwx-unit-striker")?.devices.find((device) => device.device_id === id) ?? null
}

export function strikerReportAge(device: FabricDeviceState | null, now: number): number | null {
  const seen = timestamp(device?.last_seen)
  return seen === null ? null : Math.max(0, now - seen)
}

export function strikerReading(device: FabricDeviceState | null, key: string, now: number): number | null {
  // Core's per-measurement quality is the authority. A connected board or a recent
  // Fabric frame alone does not prove a sensor value is fresh or calibrated.
  if (!device || device.connected === false || strikerReportAge(device, now) === null || strikerReportAge(device, now)! > 5_000) return null
  const quality = device.metadata?.quality as Record<string, unknown> | undefined
  const source = key === "dewpoint_c" ? "temperature_c" : key
  const entry = quality?.[source] as Record<string, unknown> | undefined
  const observedAt = timestamp(entry?.observed_at)
  if (entry?.state !== "live" || observedAt === null || now - observedAt < -5_000 || now - observedAt > 3_000) return null
  if (key === "dewpoint_c") {
    const humidity = quality?.humidity_pct as Record<string, unknown> | undefined
    const humidityAt = timestamp(humidity?.observed_at)
    if (humidity?.state !== "live" || humidityAt === null || now - humidityAt > 3_000) return null
  }
  const mesonet = device.latest?.mesonet as Record<string, unknown> | undefined
  const value = mesonet?.[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function formatStrikerReading(key: string, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—"
  if (key === "temperature_c" || key === "trunk_temperature_c" || key === "dewpoint_c") {
    return `${(value * 9 / 5 + 32).toFixed(1)} °F`
  }
  if (key === "pressure_hpa") return `${(value * 0.0295299830714).toFixed(2)} inHg`
  if (key === "speed_mps") return `${(value * 2.2369362921).toFixed(1)} mph`
  if (key === "humidity_pct") return `${value.toFixed(1)}%`
  if (key === "wind_hz") return `${value.toFixed(1)} Hz`
  if (key === "latitude" || key === "longitude") return `${value.toFixed(5)}°`
  return `${value.toFixed(1)}°`
}
