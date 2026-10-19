import type { FabricDeviceState, FabricUnitState } from "../../../../src/services/fabric/types"

const MAX_LIVE_AGE_MS = 15_000
const FIELDS = [
  { key: "temperature_c", label: "Temperature" },
  { key: "humidity_pct", label: "Humidity" },
  { key: "dewpoint_c", label: "Dew point" },
  { key: "wind_hz", label: "Wind pulses" },
  { key: "wind_mps", label: "Wind speed" },
  { key: "wind_direction_deg", label: "Wind direction" },
  { key: "pressure_hpa", label: "Pressure" },
] as const

export interface LiveChaserReading {
  key: string
  label: string
  value: string
  ageMs: number
}

function timestamp(value: unknown): number | null {
  const time = typeof value === "string" ? Date.parse(value)
    : typeof value === "number" ? (value < 100_000_000_000 ? value * 1000 : value) : NaN
  return Number.isFinite(time) && time > 0 ? time : null
}

function liveValue(device: FabricDeviceState, key: string, now: number): { value: number; ageMs: number } | null {
  if (device.connected === false) return null
  const lastSeen = timestamp(device.last_seen)
  if (lastSeen === null || now - lastSeen > MAX_LIVE_AGE_MS || now - lastSeen < -5_000) return null
  // A recent board report is not proof that every attached sensor is working.
  const quality = device.metadata?.quality as Record<string, unknown> | undefined
  const qualityKey = key === "dewpoint_c" ? "temperature_c" : key
  const entry = quality?.[qualityKey] as Record<string, unknown> | undefined
  const observedAt = timestamp(entry?.observed_at)
  if (entry?.state !== "live" || observedAt === null || now - observedAt > MAX_LIVE_AGE_MS || now - observedAt < -5_000) return null
  if (key === "dewpoint_c") {
    const humidity = quality?.humidity_pct as Record<string, unknown> | undefined
    const humidityAt = timestamp(humidity?.observed_at)
    if (humidity?.state !== "live" || humidityAt === null || now - humidityAt > MAX_LIVE_AGE_MS || now - humidityAt < -5_000) return null
  }
  const mesonet = device.latest?.mesonet as Record<string, unknown> | undefined
  const value = mesonet?.[key]
  return typeof value === "number" && Number.isFinite(value) ? { value, ageMs: Math.max(0, now - observedAt) } : null
}

export function formatChaserReading(key: string, value: number): string {
  if (key === "temperature_c" || key === "dewpoint_c") return `${(value * 9 / 5 + 32).toFixed(1)} °F`
  if (key === "pressure_hpa") return `${(value * 0.0295299830714).toFixed(2)} inHg`
  if (key === "wind_mps") return `${(value * 2.2369362921).toFixed(1)} mph`
  if (key === "humidity_pct") return `${value.toFixed(1)}%`
  if (key === "wind_hz") return `${value.toFixed(1)} Hz`
  return `${value.toFixed(0)}°`
}

export function liveChaserReadings(unit: FabricUnitState, now: number): LiveChaserReading[] {
  if (unit.unit_type !== "chase-platform") return []
  return FIELDS.flatMap(({ key, label }) => {
    for (const device of unit.devices) {
      const reading = liveValue(device, key, now)
      if (reading) return [{ key, label, value: formatChaserReading(key, reading.value), ageMs: reading.ageMs }]
    }
    return []
  })
}
