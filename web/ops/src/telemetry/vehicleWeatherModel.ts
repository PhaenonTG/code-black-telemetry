import type { FabricUnitState, FabricDeviceState } from "../../../../src/services/fabric/types"

export type ReadingState = "CURRENT" | "STALE" | "OFFLINE" | "UNAVAILABLE" | "CLOCK ERROR"
export type Metric = { id: string; label: string; unit: string; value: number | null; state: ReadingState; observedAt: number | null; deviceId: string | null; calibration: string; reason: string }
type Device = FabricDeviceState & { latest?: Record<string, unknown> }
export type WeatherView = { unit: FabricUnitState | null; metrics: Metric[]; reason: string; receivedAt: number | null }
export const LIVE_WINDOW_MS = 3_000 // Same per-reading window as Core mesonet.py, not unit heartbeat age.
const fields = [
  ["wind_mps", "Apparent wind", "mph", 2.2369362921, 0, 150],
  ["gust_mps", "Gust", "mph", 2.2369362921, 0, 150],
  ["wind_avg_mps", "Average apparent wind", "mph", 2.2369362921, 0, 150],
  ["wind_direction_deg", "Wind direction", "°", 1, 0, 360],
  ["temperature_c", "Temperature", "°F", 1.8, -80, 125],
  ["dewpoint_c", "Dewpoint · derived", "°F", 1.8, -100, 125],
  ["humidity_pct", "Humidity", "%", 1, 0, 100],
  ["pressure_hpa", "Pressure", "hPa", 1, 300, 1200],
  ["speed_mps", "Vehicle speed", "mph", 2.2369362921, 0, 150],
  ["heading_deg", "Vehicle heading", "°", 1, 0, 360],
  ["trunk_temperature_c", "Trunk temperature", "°F", 1.8, -80, 125],
] as const
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
export function timestamp(value: unknown): number | null {
  const result = typeof value === "number" ? value : typeof value === "string" && /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN
  return Number.isFinite(result) && result > 0 ? result : null
}
const unavailable = (id: string, label: string, unit: string, reason: string): Metric => ({ id, label, unit, value: null, state: "UNAVAILABLE", observedAt: null, deviceId: null, calibration: "Unknown", reason })

export function vehicleWeather(units: FabricUnitState[], selectedId: string, now: number, receivedAt: number | null, connected: boolean): WeatherView {
  const matches = units.filter(unit => unit.unit_id === selectedId && unit.unit_type === "chase-platform")
  const unit = selectedId && matches.length === 1 ? matches[0] : null
  const reason = !selectedId ? "Choose a chaser to view their vehicle." : !unit ? "Selected chaser unavailable. No other vehicle substituted." : ""
  const devices = (unit?.devices ?? []).filter(device => device.unit_id === selectedId) as Device[]
  const metrics = fields.map(([id, label, suffix, factor, min, max]): Metric => {
    if (!unit) return unavailable(id, label, suffix, reason)
    // Never use the unit weather aggregate: it has no per-field provenance or clock.
    const sources = devices.filter(device => Object.hasOwn(record(record(device.latest).mesonet), id))
    if (sources.length !== 1) return unavailable(id, label, suffix, sources.length ? "Multiple device sources; reading withheld." : "Not reported by this vehicle.")
    const device = sources[0], readings = record(record(device.latest).mesonet), quality = record(device.metadata?.quality)
    const q = record(quality[id === "dewpoint_c" ? "temperature_c" : id])
    const humidity = record(quality.humidity_pct)
    const times = id === "dewpoint_c" ? [timestamp(q.observed_at), timestamp(humidity.observed_at)] : [timestamp(q.observed_at)]
    const observedAt = times.every(time => time !== null) ? Math.min(...times as number[]) : null
    const value = readings[id]
    const valid = typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && device.metadata?.simulated !== true && unit.metadata?.simulated !== true
    const calibration = device.metadata?.calibration_verified === true ? "Verified" : "Unverified"
    const base = { id, label, unit: suffix, observedAt, deviceId: device.device_id, calibration }
    if (!valid || observedAt === null || q.state !== "live" || (id === "dewpoint_c" && humidity.state !== "live")) return { ...base, value: null, state: "UNAVAILABLE", reason: "Missing, invalid or rejected sensor reading." }
    if (now < observedAt || (receivedAt !== null && now < receivedAt)) return { ...base, value: null, state: "CLOCK ERROR", reason: "Source or browser clock is ahead; reading withheld." }
    const age = now - observedAt
    const offline = !connected || device.connected === false || device.health_state === "OFFLINE" || device.health_state === "NOT_CONFIGURED"
    const state: ReadingState = offline ? "OFFLINE" : device.health_state === "STALE" || age > LIVE_WINDOW_MS || receivedAt === null || now - receivedAt > LIVE_WINDOW_MS ? "STALE" : "CURRENT"
    return { ...base, value: value * factor + (suffix === "°F" ? 32 : 0), state, reason: state === "CURRENT" ? "Within Core’s 3-second observation window." : offline ? "Source connection unavailable; last observation only." : "Outside the 3-second live window; last observation only." }
  })
  return { unit, metrics, reason, receivedAt }
}
