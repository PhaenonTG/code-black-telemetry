import type { FabricUnitState } from "../../../../src/services/fabric/types"
import type { AlertProduct } from "../../../../src/services/situational"

export type Point = { lat: number; lon: number }

export function coordinates(value: Record<string, unknown> | null | undefined): Point | null {
  if (!value) return null
  const latitude = value.lat ?? value.latitude
  const longitude = value.lon ?? value.lng ?? value.longitude
  if (latitude == null || longitude == null || latitude === "" || longitude === "") return null
  const lat = Number(latitude), lon = Number(longitude)
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null
}

export function numberField(row: Record<string, unknown> | null | undefined, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = row?.[key]
    if (value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))) return Number(value)
  }
  return null
}

export function ageLabel(value: string | number | null | undefined, now = Date.now()): string {
  const time = typeof value === "number" ? value : value ? Date.parse(value) : NaN
  if (!Number.isFinite(time)) return "Time unknown"
  if (time - now > 60_000) return "Clock mismatch"
  const minutes = Math.max(0, Math.floor((now - time) / 60_000))
  return minutes < 1 ? "Just now" : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m ago` : `${Math.floor(minutes / 1440)}d ago`
}

export function localTime(value: string | number | null | undefined): string {
  const date = new Date(value ?? NaN)
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : "Time unavailable"
}

export function distanceMiles(a: Point, b: Point): number {
  const radians = Math.PI / 180
  const h = Math.sin((b.lat - a.lat) * radians / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin((b.lon - a.lon) * radians / 2) ** 2
  return 7917.6 * Math.asin(Math.sqrt(Math.min(1, h)))
}

export function bearing(a: Point, b: Point): string {
  const r = Math.PI / 180
  const degrees = (Math.atan2(Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r), Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r)) / r + 360) % 360
  return `${Math.round(degrees)}° ${["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(degrees / 22.5) % 16]}`
}

export function freshUnitLocation(unit: FabricUnitState | null, now = Date.now()): Point | null {
  if (!unit || unit.overall_health === "OFFLINE" || unit.last_seen == null || !Number.isFinite(unit.last_seen) || now - unit.last_seen > 120_000 || unit.last_seen - now > 60_000) return null
  return coordinates(unit.location)
}

const SEVERITY = { pds: 0, tornado: 1, "flash-flood": 2, severe: 3, watch: 4, md: 5, other: 6 }
export function currentAlerts(alerts: AlertProduct[], now = Date.now()): AlertProduct[] {
  const seen = new Set<string>()
  return alerts.filter((alert) => {
    if (seen.has(alert.id)) return false
    const expires = Date.parse(alert.expires)
    if (!Number.isFinite(expires) || expires <= now) return false
    seen.add(alert.id)
    return true
  }).sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity] || Date.parse(b.sent) - Date.parse(a.sent))
}

export function strings(row: Record<string, unknown> | null | undefined, key: string): string[] {
  const value = row?.[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 8) : typeof value === "string" ? [value] : []
}
