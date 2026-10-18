// Reuses the OPS app's existing, already-approved status vocabulary
// (src/services/operationalStatus.ts) rather than inventing a parallel one.
import { stateTone, type OperationalState } from "../../../../src/services/operationalStatus"
import type { FabricPresenceState, FabricUnitState } from "../../../../src/services/fabric/types"
import type { OpsConnectionState } from "../core/types"
import { buildCoreRequestHeaders, currentAccessToken, retryOnceOnTransient } from "../core/client"
import { coreConfigured, type OpsCoreConfig } from "../core/config"
import { liveChaserReadings } from "../pages/strikerReadings"
import { requestDeadline } from "../core/requestDeadline"
import { probeRadarHealth, probeSingleSiteRadarHealth, probeWeatherHealth, probeAlertsHealth, readMapHealth, type ExternalHealthSnapshot } from "./externalHealth"

export { stateTone, type OperationalState }

export interface SystemStatusLine {
  key: string
  label: string
  state: OperationalState | OpsConnectionState
  detail: string
}

export interface ObservableHealth {
  state: OperationalState
  detail: string
  asOf?: number
}

// Public/external services are independent of Core. Callers provide observed health;
// a reachable Core API alone does not establish vehicle telemetry or fleet presence.
export function buildSystemStatus(params: {
  coreReachable?: boolean
  core?: { state: OpsConnectionState; detail: string }
  telemetry?: ObservableHealth
  fabric: { state: OpsConnectionState; units: { units: Array<{ overall_health: FabricPresenceState }> } | null }
  map: ObservableHealth
  radar: ObservableHealth
  singleSiteRadar: ObservableHealth
  forecast: ObservableHealth
  hurricane: ObservableHealth
  weather: ObservableHealth
  alerts: ObservableHealth
}): SystemStatusLine[] {
  const networkOnline = typeof navigator === "undefined" ? true : navigator.onLine
  const fleet = fleetStatus(params.fabric)

  const rows: SystemStatusLine[] = [
    {
      key: "core",
      label: "CORE",
      state: params.core?.state ?? (params.coreReachable ? "CONNECTED" : "OFFLINE"),
      detail: params.core ? plainHealthDetail(params.core.detail) : params.coreReachable
        ? "CodeBlack-Core API reachable"
        : "No connection to CodeBlack-Core",
    },
    {
      key: "network",
      label: "NETWORK",
      state: networkOnline ? "READY" : "OFFLINE",
      detail: networkOnline ? "Browser reports online" : "Browser reports offline",
    },
    { key: "map", label: "MAP DATA", ...params.map },
    { key: "radar", label: "RADAR MOSAIC SOURCE", ...params.radar },
    { key: "singleSiteRadar", label: "SINGLE-SITE RADAR", ...params.singleSiteRadar },
    { key: "forecast", label: "FORECAST API", ...params.forecast },
    { key: "hurricane", label: "HURRICANE WATCH", ...params.hurricane },
    { key: "weather", label: "NWS WEATHER API", ...params.weather },
    { key: "alerts", label: "NWS ALERTS API", ...params.alerts },
    {
      key: "telemetry",
      label: "TELEMETRY",
      ...(params.telemetry ?? { state: "NOT_CONFIGURED", detail: "Not monitored" }),
    },
    { key: "fleet", label: "FLEET", ...fleet },
    {
      key: "streaming",
      label: "STREAMING",
      state: "NO_DATA",
      detail: "No active broadcast is expected by default; open Program Status for live ingest telemetry",
    },
  ]
  return rows.map((row) => ({ ...row, detail: plainHealthDetail(row.detail) }))
}

function fleetStatus(fabric: { state: OpsConnectionState; units: { units: Array<{ overall_health: FabricPresenceState }> } | null }): ObservableHealth {
  if (fabric.state === "CHECKING") return { state: "CHECKING", detail: "Waiting for Fabric unit snapshot" }
  if (fabric.state !== "LIVE" || !fabric.units) return { state: "NO_DATA", detail: "Fabric unit presence not confirmed" }

  const units = fabric.units.units
  if (units.length === 0) return { state: "NO_DATA", detail: "No units registered in Fabric" }
  const live = units.filter((unit) => unit.overall_health === "LIVE").length
  if (live > 0) return { state: "LIVE", detail: `${live} of ${units.length} registered unit${units.length === 1 ? "" : "s"} live` }
  if (units.some((unit) => unit.overall_health === "DEGRADED")) return { state: "DEGRADED", detail: "Registered units reporting degraded; none live" }
  if (units.some((unit) => unit.overall_health === "STALE")) return { state: "STALE", detail: "Registered units stale; none live" }
  if (units.some((unit) => unit.overall_health === "OFFLINE")) return { state: "OFFLINE", detail: "Registered units offline" }
  return { state: "NOT_CONFIGURED", detail: "Registered units have no configured presence source" }
}

export function plainHealthDetail(error: unknown, retrying = false): string {
  const text = error instanceof Error ? error.message : String(error)
  const name = error instanceof Error ? error.name : ""
  if (name === "AbortError" || name === "TimeoutError" || /abort|timeout|timed out/i.test(text)) return retrying ? "Timed out, retrying" : "Timed out"
  const http = /HTTP (\d{3})/.exec(text)
  if (http) return `Service unavailable (HTTP ${http[1]})`
  if (error instanceof TypeError || /fetch|network/i.test(text)) return "Could not reach service"
  if (error instanceof Error) return "Service unavailable"
  return text
}

export function retainHealth(previous: ObservableHealth, next: ObservableHealth, checkedAt: number): ObservableHealth {
  if (next.state === "LIVE" || next.state === "READY") return { ...next, asOf: checkedAt }
  if (next.state === "UNAVAILABLE" && previous.asOf) {
    const detail = previous.detail.split(" - as of ")[0]
    return { ...previous, state: "STALE", detail: `${detail} - as of ${new Date(previous.asOf).toLocaleString()} - ${next.detail}` }
  }
  return next
}

/** Same endpoints/headers as the existing probes, with a bounded cold-start retry. */
export async function probeSystemCore(config: OpsCoreConfig, path: "runs" | "hurricane-watch"): Promise<ObservableHealth> {
  if (!coreConfigured(config)) return { state: "NOT_CONFIGURED", detail: "Core forecast gateway is not configured" }
  try {
    return await requestDeadline((outer) => retryOnceOnTransient(() => requestDeadline(async (signal) => {
      const token = await currentAccessToken()
      signal.throwIfAborted()
      const response = await fetch(`${config.coreBaseUrl}/api/forecast/v1/${path}`, {
        cache: "no-store", signal, headers: buildCoreRequestHeaders(token),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json() as Record<string, unknown>
      if (path === "runs" && !Array.isArray(body.runs)) throw new Error("Invalid forecast data")
      if (path === "hurricane-watch" && typeof body.status !== "string") throw new Error("Invalid hurricane data")
      return { state: "LIVE" as const, detail: path === "runs" ? `Core forecast API ready - ${(body.runs as unknown[]).length} runs` : `Core hurricane watch ready - ${body.status}` }
    }, 8_000, outer)), 15_000)
  } catch (error) { return { state: "UNAVAILABLE", detail: plainHealthDetail(error) } }
}

export async function probeSystemHealth(config: OpsCoreConfig): Promise<ExternalHealthSnapshot> {
  const [radar, singleSiteRadar, forecast, hurricane, weather, alerts] = await Promise.all([
    probeRadarHealth(), probeSingleSiteRadarHealth(), probeSystemCore(config, "runs"),
    probeSystemCore(config, "hurricane-watch"), probeWeatherHealth(), probeAlertsHealth(),
  ])
  return { map: readMapHealth(), radar, singleSiteRadar, forecast, hurricane, weather, alerts, checkedAt: Date.now() }
}

/** Reuse the quality-checked sensor readings already available in the Fabric snapshot. */
export function systemTelemetry(units: FabricUnitState[], fabricState: OpsConnectionState, now: number): ObservableHealth {
  const samples = units.flatMap(unit => liveChaserReadings(unit, now))
  if (!samples.length) return { state: "NOT_CONFIGURED", detail: "Not monitored" }
  const observedAt = now - Math.max(...samples.map(sample => sample.ageMs))
  return { state: fabricState === "LIVE" ? "LIVE" : "STALE", detail: `${samples.length} verified sensor sample(s) - as of ${new Date(observedAt).toLocaleString()}`, asOf: observedAt }
}
