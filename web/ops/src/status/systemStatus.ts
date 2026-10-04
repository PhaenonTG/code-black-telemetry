// Reuses the OPS app's existing, already-approved status vocabulary
// (src/services/operationalStatus.ts) rather than inventing a parallel one.
import { stateTone, type OperationalState } from "../../../../src/services/operationalStatus"
import type { FabricPresenceState } from "../../../../src/services/fabric/types"
import type { OpsConnectionState } from "../core/types"

export { stateTone, type OperationalState }

export interface SystemStatusLine {
  key: string
  label: string
  state: OperationalState
  detail: string
}

export interface ObservableHealth {
  state: OperationalState
  detail: string
}

// Public/external services are independent of Core. Callers provide observed health;
// a reachable Core API alone does not establish vehicle telemetry or fleet presence.
export function buildSystemStatus(params: {
  coreReachable: boolean
  fabric: { state: OpsConnectionState; units: { units: Array<{ overall_health: FabricPresenceState }> } | null }
  map: ObservableHealth
  radar: ObservableHealth
  singleSiteRadar: ObservableHealth
  weather: ObservableHealth
  alerts: ObservableHealth
}): SystemStatusLine[] {
  const networkOnline = typeof navigator === "undefined" ? true : navigator.onLine
  const fleet = fleetStatus(params.fabric)

  return [
    {
      key: "core",
      label: "CORE",
      state: params.coreReachable ? "CONNECTED" : "OFFLINE",
      detail: params.coreReachable
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
    { key: "radar", label: "RADAR", ...params.radar },
    { key: "singleSiteRadar", label: "SINGLE-SITE RADAR", ...params.singleSiteRadar },
    { key: "weather", label: "WEATHER", ...params.weather },
    { key: "alerts", label: "ALERTS", ...params.alerts },
    {
      key: "telemetry",
      label: "TELEMETRY",
      state: "NO_DATA",
      detail: params.coreReachable ? "Core reachable; no live vehicle sample confirmed" : "No live vehicle sample confirmed",
    },
    { key: "fleet", label: "FLEET", ...fleet },
    {
      key: "streaming",
      label: "STREAMING",
      state: "NOT_CONFIGURED",
      detail: "Deferred",
    },
  ]
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
