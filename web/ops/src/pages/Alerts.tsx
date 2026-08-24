import { useEffect, useState } from "react"
import { useAlertProducts } from "../../../../src/hooks/useAlertProducts"
import { browserLocationAdapter, type LocationState } from "../adapters"
import { PageHeader } from "../components/PageHeader"

// Reuses the existing alert hook (src/hooks/useAlertProducts.ts) directly -- same NWS fetch,
// same severity model, no duplicated logic.
export default function Alerts() {
  const [gps, setGps] = useState<LocationState>({ status: "requesting" })
  useEffect(() => {
    let cancelled = false
    void browserLocationAdapter.getCurrent().then((s) => { if (!cancelled) setGps(s) })
    const unwatch = browserLocationAdapter.watch((s) => { if (!cancelled) setGps(s) })
    return () => { cancelled = true; unwatch() }
  }, [])

  const gpsPoint = gps.status === "ready" ? { lat: gps.lat, lon: gps.lon } : null
  const { products, error } = useAlertProducts(gpsPoint)

  return (
    <div className="page page-alerts">
      <PageHeader title="Alerts" kicker="ACTIVE NWS PRODUCTS" />
      {gps.status === "denied" && <p className="page-empty">LOCATION DENIED — alerts need a position.</p>}
      {gps.status === "requesting" && <p className="page-empty">Locating…</p>}
      {error && <p className="page-empty">ALERTS UNAVAILABLE — {error}</p>}
      {!error && gps.status === "ready" && products.length === 0 && <p className="page-empty">No active alerts at current position.</p>}
      <ul className="ops-alert-list">
        {products.map((p) => (
          <li key={p.id} className="ops-alert-row">
            <b>{p.title || p.headline || "Alert"}</b>
            {p.headline && p.title && <p>{p.headline}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}
