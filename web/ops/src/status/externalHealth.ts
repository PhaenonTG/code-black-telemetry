import { hasMapboxToken, readMapRuntimeDiagnostics } from "../../../../src/services/mapTiles"
import type { OperationalState } from "../../../../src/services/operationalStatus"

export interface ExternalHealthResult {
  state: OperationalState
  detail: string
}

export interface ExternalHealthSnapshot {
  map: ExternalHealthResult
  radar: ExternalHealthResult
  weather: ExternalHealthResult
  alerts: ExternalHealthResult
  checkedAt: number
}

const MAP_RUNTIME_FRESH_MS = 5 * 60_000
const REQUEST_TIMEOUT_MS = 5_000

// Known-good public endpoints used only as provider reachability probes. They do not
// populate user-facing weather/alert content and do not represent the user's location.
const RADAR_PROBE_URL =
  "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/7/30/50.png"
const WEATHER_PROBE_URL = "https://api.weather.gov/points/36.3729,-94.2088"
const ALERTS_PROBE_URL = "https://api.weather.gov/alerts/active?area=AR"

function online(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine
}

async function probeUrl(
  url: string,
  accept: string,
  successDetail: string,
  failureDetail: string,
): Promise<ExternalHealthResult> {
  if (!online()) {
    return { state: "OFFLINE", detail: "Browser reports no network connection" }
  }

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: accept },
    })

    if (!response.ok) {
      return {
        state: "UNAVAILABLE",
        detail: `${failureDetail} · HTTP ${response.status}`,
      }
    }

    return { state: "LIVE", detail: successDetail }
  } catch (error) {
    const suffix =
      error instanceof DOMException && error.name === "AbortError"
        ? "timeout"
        : error instanceof Error
          ? error.message
          : "request failed"

    return { state: "UNAVAILABLE", detail: `${failureDetail} · ${suffix}` }
  } finally {
    window.clearTimeout(timer)
  }
}

export function readMapHealth(now = Date.now()): ExternalHealthResult {
  if (!online()) {
    return { state: "OFFLINE", detail: "Browser reports no network connection" }
  }

  if (!hasMapboxToken()) {
    return { state: "NOT_CONFIGURED", detail: "Mapbox public token is not configured" }
  }

  const diagnostics = readMapRuntimeDiagnostics()
  if (!diagnostics) {
    return {
      state: "CHECKING",
      detail: "Map runtime has not reported a rendered style in this browser yet",
    }
  }

  const ageMs = Math.max(0, now - diagnostics.updatedAt)
  if (ageMs > MAP_RUNTIME_FRESH_MS) {
    return {
      state: "STALE",
      detail: `Last map runtime report is ${Math.round(ageMs / 60_000)}m old`,
    }
  }

  if (!diagnostics.styleLoaded) {
    return {
      state: "UNAVAILABLE",
      detail: "Map runtime reported that the base style is not loaded",
    }
  }

  return {
    state: "READY",
    detail: "Map runtime reported a loaded base style",
  }
}

export async function probeRadarHealth(): Promise<ExternalHealthResult> {
  return probeUrl(
    `${RADAR_PROBE_URL}?health=${Date.now()}`,
    "image/png,image/*;q=0.8,*/*;q=0.5",
    "IEM NEXRAD mosaic tile source reachable",
    "NEXRAD mosaic source unavailable",
  )
}

export async function probeWeatherHealth(): Promise<ExternalHealthResult> {
  return probeUrl(
    WEATHER_PROBE_URL,
    "application/geo+json, application/json",
    "NWS weather API reachable",
    "NWS weather API unavailable",
  )
}

export async function probeAlertsHealth(): Promise<ExternalHealthResult> {
  return probeUrl(
    ALERTS_PROBE_URL,
    "application/geo+json, application/json",
    "NWS alerts API reachable",
    "NWS alerts API unavailable",
  )
}

export async function probeExternalHealth(): Promise<ExternalHealthSnapshot> {
  const [radar, weather, alerts] = await Promise.all([
    probeRadarHealth(),
    probeWeatherHealth(),
    probeAlertsHealth(),
  ])

  return {
    map: readMapHealth(),
    radar,
    weather,
    alerts,
    checkedAt: Date.now(),
  }
}
