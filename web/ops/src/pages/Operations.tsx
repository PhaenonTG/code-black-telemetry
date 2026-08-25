import { useEffect, useState } from "react"
import { buildSystemStatus, type ObservableHealth } from "../status/systemStatus"
import {
  probeExternalHealth,
  readMapHealth,
  type ExternalHealthSnapshot,
} from "../status/externalHealth"
import { StatusBadge } from "../components/StatusBadge"
import { PageHeader } from "../components/PageHeader"

const CHECKING: ObservableHealth = {
  state: "CHECKING",
  detail: "Provider check in progress",
}

function initialHealth(): ExternalHealthSnapshot {
  return {
    map: readMapHealth(),
    radar: CHECKING,
    singleSiteRadar: CHECKING,
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

  useEffect(() => {
    let cancelled = false

    const refresh = async () => {
      // Map runtime health is local/observable and can update as soon as the user visits Map.
      setHealth((current) => ({ ...current, map: readMapHealth() }))

      const next = await probeExternalHealth()
      if (!cancelled) setHealth(next)
    }

    void refresh()

    // External providers do not need aggressive polling on a status page.
    const probeTimer = window.setInterval(refresh, 60_000)

    // Map diagnostics are cheap localStorage reads; keep this row responsive if a map is opened
    // in another route/tab and then the user returns to Operations.
    const mapTimer = window.setInterval(() => {
      if (!cancelled) {
        setHealth((current) => ({ ...current, map: readMapHealth() }))
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
  }, [])

  const rows = buildSystemStatus({
    coreReachable: false,
    map: health.map,
    radar: health.radar,
    singleSiteRadar: health.singleSiteRadar,
    weather: health.weather,
    alerts: health.alerts,
  })

  return (
    <div className="page page-operations">
      <PageHeader title="Operations" kicker="SYSTEM STATUS" />
      <div className="status-table">
        {rows.map((row) => (
          <div key={row.key} className="status-row">
            <span className="status-row__label">{row.label}</span>
            <StatusBadge state={row.state} />
            <span className="status-row__detail">{row.detail}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
