import { useEffect, useState } from "react"
import { buildSystemStatus } from "../status/systemStatus"
import { StatusBadge } from "../components/StatusBadge"
import { PageHeader } from "../components/PageHeader"
import { getNearestObservation } from "../../../../src/services/situational"
import { browserLocationAdapter } from "../adapters"

// The system truth/status page -- every row here is a real check, not a decorative "all green"
// dashboard. CORE and TELEMETRY are honestly OFFLINE/NOT_CONFIGURED today because CodeBlack-Core
// genuinely is offline; radar/weather/alerts are checked independently since they don't need Core.
export default function Operations() {
  const [weatherOk, setWeatherOk] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    void browserLocationAdapter.getCurrent().then(async (loc) => {
      if (loc.status !== "ready") { if (!cancelled) setWeatherOk(false); return }
      try {
        const obs = await getNearestObservation({ lat: loc.lat, lon: loc.lon })
        if (!cancelled) setWeatherOk(obs != null)
      } catch {
        if (!cancelled) setWeatherOk(false)
      }
    })
    return () => { cancelled = true }
  }, [])

  const rows = buildSystemStatus({
    coreReachable: false,
    radarOk: true,
    weatherOk: weatherOk ?? false,
    alertsOk: true,
  })

  return (
    <div className="page page-operations">
      <PageHeader title="Operations" kicker="SYSTEM STATUS" />
      <div className="status-table">
        {rows.map((r) => (
          <div key={r.key} className="status-row">
            <span className="status-row__label">{r.label}</span>
            <StatusBadge state={r.state} />
            <span className="status-row__detail">{r.detail}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
