import { useEffect, useState } from "react"
import { getNearestObservation, type ExternalObservation } from "../../../../src/services/situational"
import { browserLocationAdapter, type LocationState } from "../adapters"
import { PageHeader } from "../components/PageHeader"

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="ops-metric-tile">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  )
}

// Public/external observation data only -- reuses the existing fetch/parse layer
// (src/services/situational.ts) directly, independent of CodeBlack-Core.
export default function Weather() {
  const [gps, setGps] = useState<LocationState>({ status: "requesting" })
  const [obs, setObs] = useState<ExternalObservation | null | "loading" | "error">("loading")

  useEffect(() => {
    let cancelled = false
    void browserLocationAdapter.getCurrent().then((s) => { if (!cancelled) setGps(s) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (gps.status !== "ready") return
    let cancelled = false
    setObs("loading")
    getNearestObservation({ lat: gps.lat, lon: gps.lon })
      .then((o) => { if (!cancelled) setObs(o) })
      .catch(() => { if (!cancelled) setObs("error") })
    return () => { cancelled = true }
  }, [gps])

  return (
    <div className="page page-weather">
      <PageHeader title="Weather" kicker="NEAREST PUBLIC OBSERVATION" />
      {gps.status === "requesting" && <p className="page-empty">Locating…</p>}
      {gps.status === "denied" && <p className="page-empty">LOCATION DENIED — weather needs a position to find the nearest observation.</p>}
      {gps.status === "unavailable" && <p className="page-empty">LOCATION UNAVAILABLE</p>}
      {gps.status === "ready" && obs === "loading" && <p className="page-empty">Loading observation…</p>}
      {gps.status === "ready" && obs === "error" && <p className="page-empty">WEATHER UNAVAILABLE — request failed.</p>}
      {gps.status === "ready" && obs === null && <p className="page-empty">NO DATA — no nearby observation station reported.</p>}
      {gps.status === "ready" && obs && obs !== "loading" && obs !== "error" && (
        <div className="ops-metric-grid">
          <Metric label="Temp" value={obs.tempF != null ? `${Math.round(obs.tempF)}°F` : "—"} />
          <Metric label="Wind" value={obs.windSpeedMph != null ? `${Math.round(obs.windSpeedMph)} mph` : "—"} />
          <Metric label="Gust" value={obs.windGustMph != null ? `${Math.round(obs.windGustMph)} mph` : "—"} />
          <Metric label="RH" value={obs.humidity != null ? `${Math.round(obs.humidity)}%` : "—"} />
          <Metric label="Dewpoint" value={obs.dewpointF != null ? `${Math.round(obs.dewpointF)}°F` : "—"} />
        </div>
      )}
    </div>
  )
}
