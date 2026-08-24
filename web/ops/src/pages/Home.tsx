import { useEffect, useState, type KeyboardEvent } from "react"
import { useNavigate } from "react-router-dom"
import { AtlasMap } from "../../../../src/map/AtlasMap"
import { getNearestObservation, type ExternalObservation } from "../../../../src/services/situational"
import { useAlertProducts } from "../../../../src/hooks/useAlertProducts"
import { browserLocationAdapter, type LocationState } from "../adapters"
import { StatusBadge } from "../components/StatusBadge"
import { PageHeader } from "../components/PageHeader"

function navProps(navigate: (path: string) => void, path: string, label: string) {
  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-label": `Open ${label}`,
    onClick: () => navigate(path),
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(path) }
    },
  }
}

// Operational overview, not a marketing dashboard -- every module reflects a real state (radar
// preview is a real live map, weather/alerts are real fetches, Core/Fleet are honestly offline).
// Whole-module tap navigates (matches the same direct-action convention already shipped on the
// public site's Home page) -- no redundant "Open X" buttons.
export default function Home() {
  const navigate = useNavigate()
  const [gps, setGps] = useState<LocationState>({ status: "requesting" })
  const [obs, setObs] = useState<ExternalObservation | null>(null)

  useEffect(() => {
    let cancelled = false
    void browserLocationAdapter.getCurrent().then((s) => { if (!cancelled) setGps(s) })
    const unwatch = browserLocationAdapter.watch((s) => { if (!cancelled) setGps(s) })
    return () => { cancelled = true; unwatch() }
  }, [])

  useEffect(() => {
    if (gps.status !== "ready") return
    let cancelled = false
    getNearestObservation({ lat: gps.lat, lon: gps.lon }).then((o) => { if (!cancelled) setObs(o) }).catch(() => {})
    return () => { cancelled = true }
  }, [gps])

  const gpsPoint = gps.status === "ready" ? { lat: gps.lat, lon: gps.lon } : null
  const { products } = useAlertProducts(gpsPoint)
  const atlasGps = gps.status === "ready"
    ? { lat: gps.lat, lon: gps.lon, headingDeg: gps.headingDeg, speedMph: gps.speedMph, accuracyM: gps.accuracyM }
    : null

  return (
    <div className="page page-home">
      <PageHeader title="Field Overview" kicker="CODE BLACK OPS" />
      <div className="home-grid">
        <section className="ops-home-module ops-home-module--radar" {...navProps(navigate, "/map", "Map")}>
          <div className="ops-home-module__head"><span>Radar</span><strong>MOSAIC</strong></div>
          <div className="ops-home-module__map" onClick={(e) => e.stopPropagation()}>
            <AtlasMap gps={atlasGps} rangeRings="off" statusLines={[]} controlsVariant="compact" active />
          </div>
        </section>

        <section className="ops-home-module" {...navProps(navigate, "/weather", "Weather")}>
          <div className="ops-home-module__head"><span>Weather</span><strong>{obs ? "LIVE" : "—"}</strong></div>
          <div className="ops-home-module__primary">{obs?.tempF != null ? `${Math.round(obs.tempF)}°F` : "—"}</div>
          <div className="ops-home-module__grid">
            <span>Wind</span><b>{obs?.windSpeedMph != null ? `${Math.round(obs.windSpeedMph)} mph` : "—"}</b>
            <span>RH</span><b>{obs?.humidity != null ? `${Math.round(obs.humidity)}%` : "—"}</b>
          </div>
        </section>

        <section className="ops-home-module" {...navProps(navigate, "/alerts", "Alerts")}>
          <div className="ops-home-module__head"><span>Alerts</span><strong>{products.length}</strong></div>
          <div className="ops-home-module__primary">{products[0]?.title || "No active alerts"}</div>
        </section>

        <section className="ops-home-module" {...navProps(navigate, "/operations", "Operations")}>
          <div className="ops-home-module__head"><span>System</span><StatusBadge state="OFFLINE" /></div>
          <div className="ops-home-module__primary">CodeBlack-Core offline</div>
        </section>

        <section className="ops-home-module" {...navProps(navigate, "/fleet", "Fleet")}>
          <div className="ops-home-module__head"><span>Fleet</span><strong>0</strong></div>
          <div className="ops-home-module__primary">No live fleet nodes</div>
        </section>

        <section className="ops-home-module" {...navProps(navigate, "/map", "Map")}>
          <div className="ops-home-module__head"><span>Location</span><strong>{gps.status === "ready" ? "LIVE" : gps.status.toUpperCase()}</strong></div>
          <div className="ops-home-module__primary">
            {gps.status === "ready" ? `${gps.lat.toFixed(3)}, ${gps.lon.toFixed(3)}` : "—"}
          </div>
        </section>
      </div>
    </div>
  )
}
