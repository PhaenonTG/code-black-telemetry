import type { FabricDeviceState, FabricNormalizedState } from "../../../../src/services/fabric/types"

export const STRIKER_SENSORS = [
  { id: "cbwx-striker-weather", title: "Weather ESP", fields: [
    { key: "temperature_c", label: "Temperature", unit: "°C" },
    { key: "humidity_pct", label: "Humidity", unit: "%" },
    { key: "dewpoint_c", label: "Dew point", unit: "°C" },
  ] },
  { id: "cbwx-striker-nav", title: "Vane / Nav ESP", fields: [
    { key: "wind_direction_deg", label: "Wind direction", unit: "°" },
    { key: "trunk_temperature_c", label: "BME280 temperature", unit: "°C" },
    { key: "pressure_hpa", label: "Pressure", unit: "hPa" },
    { key: "speed_mps", label: "GPS speed", unit: "m/s" },
    { key: "heading_deg", label: "GPS heading", unit: "°" },
    { key: "latitude", label: "Latitude", unit: "°" },
    { key: "longitude", label: "Longitude", unit: "°" },
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
