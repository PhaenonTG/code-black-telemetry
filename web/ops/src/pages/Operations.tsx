import { EmptyState } from "../components/AsyncViewState"
import { statusWord } from "../core/statusWords"
import { fetchStatusCenter } from "../status/statusCenterClient"
import { parseStreamHealth } from "../status/streamSources"
import { formatOpsTimestamp } from "../core/timeFormat"
import { useEffect, useState } from "react"
import { buildSystemStatus, probeSystemHealth, retainHealth, plainHealthDetail, systemTelemetry, type ObservableHealth } from "../status/systemStatus"
import {
  readMapHealth,
  type ExternalHealthSnapshot,
} from "../status/externalHealth"
import { OpsStatusPill } from "../components/OpsStatusPill"
import { StatusBadge } from "../components/StatusBadge"
import { PageHeader } from "../components/PageHeader"
import { useCoreOps } from "../core/useCoreOps"
import { Link } from "react-router-dom"
import { readMapProviderDiagnostics, type MapProviderDiagnostic } from "../../../../src/services/roadCameraProviders"

const CHECKING: ObservableHealth = {
  state: "CHECKING",
  detail: "Provider check in progress",
}

function initialHealth(): ExternalHealthSnapshot {
  return {
    map: readMapHealth(),
    radar: CHECKING,
    singleSiteRadar: CHECKING,
    forecast: CHECKING,
    hurricane: CHECKING,
    weather: CHECKING,
    alerts: CHECKING,
    checkedAt: 0,
  }
}

// System truth/status page. External services are probed independently from CodeBlack-Core;
// zero active alerts is still a healthy alert provider, while an actual failed provider request
// becomes UNAVAILABLE. Map readiness comes from AtlasMap runtime diagnostics rather than a
// hard-coded READY state.
export default function Operations() {
  const [health, setHealth] = useState<ExternalHealthSnapshot>(initialHealth)
  const [broadcast, setBroadcast] = useState("CHECKING")
  const [refreshNonce, setRefreshNonce] = useState(0)
  const { config, state: coreState } = useCoreOps()
  const [providerDiagnostics, setProviderDiagnostics] = useState<MapProviderDiagnostic[]>(() => readMapProviderDiagnostics())

  useEffect(() => {
    let cancelled = false

    const refresh = async () => {
      // Map runtime health is local/observable and can update as soon as the user visits Map.
      setHealth((current) => ({ ...current, map: readMapHealth() }))

      void fetchStatusCenter(config).then(document => {
        if (!cancelled) setBroadcast(parseStreamHealth(document.streaming).broadcast.state ?? "UNAVAILABLE")
      }).catch(() => { if (!cancelled) setBroadcast("UNAVAILABLE") })
      const next = await probeSystemHealth(config)
      if (!cancelled) setHealth((previous) => ({ ...next,
        forecast: retainHealth(previous.forecast, next.forecast, next.checkedAt),
        hurricane: retainHealth(previous.hurricane, next.hurricane, next.checkedAt),
      }))
    }

    void refresh()

    // External providers do not need aggressive polling on a status page.
    const probeTimer = window.setInterval(refresh, 60_000)

    // Map diagnostics are cheap localStorage reads; keep this row responsive if a map is opened
    // in another route/tab and then the user returns to Operations.
    const mapTimer = window.setInterval(() => {
      if (!cancelled) {
        setHealth((current) => ({ ...current, map: readMapHealth() }))
        setProviderDiagnostics(readMapProviderDiagnostics())
      }
    }, 5_000)

    const handleNetworkChange = () => { void refresh() }
    window.addEventListener("online", handleNetworkChange)
    window.addEventListener("offline", handleNetworkChange)

    return () => {
      cancelled = true
      window.clearInterval(probeTimer)
      window.clearInterval(mapTimer)
      window.removeEventListener("online", handleNetworkChange)
      window.removeEventListener("offline", handleNetworkChange)
    }
  }, [config, refreshNonce])

  const rows = buildSystemStatus({
    core: coreState.core,
    telemetry: systemTelemetry(coreState.fabric.units?.units ?? [], coreState.fabric.state, coreState.refreshedAt),
    fabric: coreState.fabric,
    map: health.map,
    radar: health.radar,
    singleSiteRadar: health.singleSiteRadar,
    forecast: health.forecast,
    hurricane: health.hurricane,
    weather: health.weather,
    alerts: health.alerts,
  })

  return (
    <div className="page page-operations">
      <PageHeader routePath="/status" title="" description={`Independent checks for Core, Fabric, radar, weather, alerts, and map providers${health.checkedAt ? ` · last checked ${formatOpsTimestamp(health.checkedAt)}` : ""}.`} actions={<><Link className="page-action-link" to="/settings">Settings</Link><button type="button" className="page-action-link" title="Reload system health checks" onClick={() => { setRefreshNonce((value) => value + 1) }}>Refresh</button></>} />
      <div className="ops-health-summary" aria-label="System summary">
        <section><h2>Core</h2><StatusBadge state={coreState.core.state} /></section>
        <section><h2>Fabric</h2><StatusBadge state={coreState.fabric.state} /></section>
        <section><h2>Storm Intel</h2><StatusBadge state={coreState.stormIntel.state} /></section>
        <section><h2>Fleet</h2><strong>{coreState.fabric.units?.units.length ?? "—"}</strong>{!coreState.fabric.units && <StatusBadge state="UNAVAILABLE" />}</section>
      </div>
      <div className="ops-system-grid">
        <section>
          <span>Fabric feed</span>
          <StatusBadge state={coreState.fabric.streamState} />
          <p>{plainHealthDetail(coreState.fabric.detail)}</p>
        </section>
        <section>
          <span>Storm Intel</span>
          <StatusBadge state={coreState.stormIntel.state} />
          <p>{plainHealthDetail(coreState.stormIntel.detail)}</p>
        </section>
      </div>
      <div className="status-table">
        {[...rows].sort((a, b) => Number(statusWord(a.state) === "Live" || a.state === "DEVELOPMENT") - Number(statusWord(b.state) === "Live" || b.state === "DEVELOPMENT")).map((row) => (
          <div key={row.key} className="status-row">
            <span className="status-row__label">{row.key === "streaming" ? "Broadcast" : row.label}</span>
            {row.state === "DEVELOPMENT" ? <OpsStatusPill state={row.state} label={row.state} /> : <StatusBadge state={row.key === "streaming" ? broadcast : row.state} />}
            <span className="status-row__detail">{row.detail.replace("Program Status", "Producer › Sources")}{row.key === "streaming" && <> · <Link to="/producer/sources">Open Producer › Sources →</Link></>}{(row.state === "NOT_CONFIGURED" || /not configured|configuration required|missing config/i.test(row.detail)) && <> · <Link to="/settings">Configure →</Link></>}</span>
          </div>
        ))}
      </div>
      <section className="provider-diagnostics">
        <h2>Map providers</h2>
        {providerDiagnostics.length === 0 ? <EmptyState title="No map provider diagnostics" message="Open the map with Roads or Cameras enabled to collect provider diagnostics." /> : [...providerDiagnostics].sort((a, b) => a.name.localeCompare(b.name)).map((provider) => <div className="status-row" key={`${provider.layer}:${provider.id}`}>
          <span className="status-row__label">{provider.name} · {provider.layer.toUpperCase()}</span>
          <StatusBadge state={provider.state === "error" ? "UNAVAILABLE" : provider.state === "cached" ? "DEGRADED" : "LIVE"} />
          <span className="status-row__detail">{provider.count} records · {provider.latencyMs != null ? `${provider.latencyMs} ms` : plainHealthDetail(provider.detail)}</span>
        </div>)}
      </section>
    </div>
  )
}
