// Reuses the OPS app's existing, already-approved status vocabulary (src/services/operationalStatus.ts)
// rather than inventing a parallel one -- OperationalState and stateTone() are pure functions with
// no Capacitor/BLE dependency, safe to import directly into the browser-only web shell.
import { stateTone, type OperationalState } from "../../../../src/services/operationalStatus"

export { stateTone, type OperationalState }

export interface SystemStatusLine {
  key: string
  label: string
  state: OperationalState
  detail: string
}

// CodeBlack-Core (the vehicle Pi / BLE telemetry link) is offline as a matter of current product
// state, not a bug in this shell -- reflected honestly here rather than papered over. Radar/
// weather/alerts are independent of Core (they're public data sources), so they get their own
// real state instead of inheriting Core's OFFLINE.
export function buildSystemStatus(params: {
  coreReachable: boolean
  radarOk: boolean
  weatherOk: boolean
  alertsOk: boolean
}): SystemStatusLine[] {
  return [
    { key: "core", label: "CORE", state: params.coreReachable ? "CONNECTED" : "OFFLINE", detail: params.coreReachable ? "Vehicle telemetry link connected" : "No connection to CodeBlack-Core" },
    { key: "network", label: "NETWORK", state: typeof navigator !== "undefined" && navigator.onLine ? "READY" : "OFFLINE", detail: typeof navigator !== "undefined" && navigator.onLine ? "Browser reports online" : "Browser reports offline" },
    { key: "map", label: "MAP DATA", state: "READY", detail: "Mosaic radar + base map tiles" },
    { key: "radar", label: "RADAR", state: params.radarOk ? "LIVE" : "UNAVAILABLE", detail: "NEXRAD mosaic (public source)" },
    { key: "weather", label: "WEATHER", state: params.weatherOk ? "LIVE" : "UNAVAILABLE", detail: "Nearest public observation" },
    { key: "alerts", label: "ALERTS", state: params.alertsOk ? "LIVE" : "UNAVAILABLE", detail: "NWS active products" },
    { key: "telemetry", label: "TELEMETRY", state: params.coreReachable ? "LIVE" : "NOT_CONFIGURED", detail: "Vehicle sensor telemetry" },
    { key: "fleet", label: "FLEET", state: "NO_DATA", detail: "No live fleet nodes reporting" },
    { key: "streaming", label: "STREAMING", state: "NOT_CONFIGURED", detail: "Deferred -- not this pass" },
  ]
}
