// Reuses the OPS app's existing, already-approved status vocabulary
// (src/services/operationalStatus.ts) rather than inventing a parallel one.
import { stateTone, type OperationalState } from "../../../../src/services/operationalStatus"

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

// CodeBlack-Core is currently offline as a matter of product state, but public/external
// services are independent. Callers must provide OBSERVED health for those services.
// This function deliberately contains no decorative "true => green" defaults.
export function buildSystemStatus(params: {
  coreReachable: boolean
  map: ObservableHealth
  radar: ObservableHealth
  weather: ObservableHealth
  alerts: ObservableHealth
}): SystemStatusLine[] {
  const networkOnline = typeof navigator === "undefined" ? true : navigator.onLine

  return [
    {
      key: "core",
      label: "CORE",
      state: params.coreReachable ? "CONNECTED" : "OFFLINE",
      detail: params.coreReachable
        ? "Vehicle telemetry link connected"
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
    { key: "weather", label: "WEATHER", ...params.weather },
    { key: "alerts", label: "ALERTS", ...params.alerts },
    {
      key: "telemetry",
      label: "TELEMETRY",
      state: params.coreReachable ? "LIVE" : "NOT_CONFIGURED",
      detail: "Vehicle sensor telemetry",
    },
    {
      key: "fleet",
      label: "FLEET",
      state: "NO_DATA",
      detail: "No live fleet nodes reporting",
    },
    {
      key: "streaming",
      label: "STREAMING",
      state: "NOT_CONFIGURED",
      detail: "Deferred",
    },
  ]
}
