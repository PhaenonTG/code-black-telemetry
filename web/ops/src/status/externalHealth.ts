import { hasMapboxToken, readMapRuntimeDiagnostics } from "../../../../src/services/mapTiles"
import { radarWorkerBase } from "../../../../src/services/radar"
import type { OperationalState } from "../../../../src/services/operationalStatus"
import { buildCoreRequestHeaders, currentAccessToken } from "../core/client"
import { coreConfigured, type OpsCoreConfig } from "../core/config"

export interface ExternalHealthResult {
  state: OperationalState
  detail: string
}

export interface ExternalHealthSnapshot {
  map: ExternalHealthResult
  radar: ExternalHealthResult
  singleSiteRadar: ExternalHealthResult
  forecast: ExternalHealthResult
  hurricane: ExternalHealthResult
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
      state: "CHECKING",
      detail: "Last map attempt had not finished loading its base style",
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

export async function probeSingleSiteRadarHealth(): Promise<ExternalHealthResult> {
  const base = radarWorkerBase()
  if (!base) {
    return { state: "NOT_CONFIGURED", detail: "VITE_RADAR_WORKER_URL is not set" }
  }
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${base}/api/v1/radar/status?product=REF&health=${Date.now()}`, { cache: "no-store", signal: controller.signal })
    if (!response.ok) return { state: "UNAVAILABLE", detail: `Radar status HTTP ${response.status}` }
    return interpretRadarStatus(await response.json())
  } catch (error) {
    return { state: "UNAVAILABLE", detail: error instanceof Error ? `Radar status unavailable · ${error.message}` : "Radar status unavailable" }
  } finally {
    window.clearTimeout(timer)
  }
}

export function interpretRadarStatus(value: unknown): ExternalHealthResult {
  if (!value || typeof value !== "object") return { state: "UNAVAILABLE", detail: "Radar status response malformed" }
  const status = value as Record<string, unknown>
  const age = status.dataAgeSeconds
  if (status.backendState !== "READY" || typeof age !== "number" || !Number.isFinite(age) || age < 0) {
    return { state: "NO_DATA", detail: "Radar worker reachable; no usable reflectivity frame" }
  }
  const detail = `${String(status.selectedSite ?? "Radar site")} reflectivity frame ${Math.round(age / 60)}m old`
  if (age > 15 * 60) return { state: "STALE", detail }
  if (age > 10 * 60) return { state: "AGING", detail }
  return { state: "LIVE", detail }
}

async function probeCoreForecast(config: OpsCoreConfig, path: string, label: string): Promise<ExternalHealthResult> {
  if (!coreConfigured(config)) return { state: "NOT_CONFIGURED", detail: "Core forecast gateway is not configured" }
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 8_000)
  try {
    const token = await currentAccessToken()
    const response = await fetch(`${config.coreBaseUrl}/api/forecast/v1/${path}`, {
      cache: "no-store", signal: controller.signal, headers: buildCoreRequestHeaders(token),
    })
    if (!response.ok) return { state: "UNAVAILABLE", detail: `${label} HTTP ${response.status}` }
    const body = await response.json() as Record<string, unknown>
    if (path === "runs" && !Array.isArray(body.runs)) return { state: "UNAVAILABLE", detail: "Forecast run response malformed" }
    if (path === "hurricane-watch" && typeof body.status !== "string") return { state: "UNAVAILABLE", detail: "Hurricane watch response malformed" }
    return { state: "LIVE", detail: path === "runs" ? `Core forecast API ready · ${Array.isArray(body.runs) ? body.runs.length : 0} runs` : `Core hurricane watch ready · ${body.status}` }
  } catch (error) {
    return { state: "UNAVAILABLE", detail: error instanceof Error ? `${label} unavailable · ${error.message}` : `${label} unavailable` }
  } finally {
    window.clearTimeout(timer)
  }
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

export async function probeExternalHealth(config: OpsCoreConfig): Promise<ExternalHealthSnapshot> {
  const [radar, singleSiteRadar, forecast, hurricane, weather, alerts] = await Promise.all([
    probeRadarHealth(),
    probeSingleSiteRadarHealth(),
    probeCoreForecast(config, "runs", "Forecast"),
    probeCoreForecast(config, "hurricane-watch", "Hurricane watch"),
    probeWeatherHealth(),
    probeAlertsHealth(),
  ])

  return {
    map: readMapHealth(),
    radar,
    singleSiteRadar,
    forecast,
    hurricane,
    weather,
    alerts,
    checkedAt: Date.now(),
  }
}
