import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useCoreOps } from "../core/useCoreOps"
import { fetchForecast } from "../core/client"
import { fetchStatusCenter, type StatusCenterDocument } from "../status/statusCenterClient"
import { chooseProducerSource, parseProducerSources } from "../workspaces/producerSources"
import { ProducerSituationMap } from "../workspaces/ProducerSituationMap"
import "./Workspaces.css"

const SELECTION_KEY = "codeblack.ops.producer.source.v1"
type OfficialAlert = { id?: string; event?: string; headline?: string; severity?: string; expires?: string }
type OfficialAlertResponse = { status: string; alerts: OfficialAlert[]; queried_at?: string }

function readSelection(): string {
  try { return localStorage.getItem(SELECTION_KEY) ?? "" } catch { return "" }
}

function age(timestamp: number | string | null | undefined, now: number): string {
  if (timestamp == null) return "No report"
  const time = typeof timestamp === "number" ? (timestamp < 100_000_000_000 ? timestamp * 1000 : timestamp) : Date.parse(timestamp)
  if (!Number.isFinite(time)) return "Time unavailable"
  const minutes = Math.max(0, Math.round((now - time) / 60_000))
  return minutes < 1 ? "Just now" : `${minutes} min ago`
}

function expiry(timestamp: string | undefined, now: number): string {
  const time = timestamp ? Date.parse(timestamp) : NaN
  if (!Number.isFinite(time)) return "Expiry unavailable"
  const minutes = Math.max(0, Math.ceil((time - now) / 60_000))
  return minutes > 0 ? `expires in ${minutes} min` : "expired"
}

export default function ProducerWorkspace() {
  const { config, state, selectedPoint, selectPoint } = useCoreOps()
  const [status, setStatus] = useState<StatusCenterDocument | null>(null)
  const [statusCheckedAt, setStatusCheckedAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [statusError, setStatusError] = useState("")
  const [manualSourceId, setManualSourceId] = useState(readSelection)
  const [alertSnapshot, setAlertSnapshot] = useState<{ key: string; value: OfficialAlertResponse } | null>(null)
  const [alertError, setAlertError] = useState("")

  const refreshStatus = useCallback(async () => {
    try {
      const next = await fetchStatusCenter(config)
      setStatus(next)
      setStatusCheckedAt(Date.now())
      setStatusError("")
    } catch (reason) {
      setStatusError(reason instanceof Error ? reason.message : "Stream status unavailable")
    }
  }, [config])

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshStatus(), 0)
    const timer = window.setInterval(() => void refreshStatus(), 20_000)
    const clock = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => { window.clearTimeout(initial); window.clearInterval(timer); window.clearInterval(clock) }
  }, [refreshStatus])

  const alertLatitude = selectedPoint?.lat
  const alertLongitude = selectedPoint?.lon
  const alertKey = selectedPoint ? `${selectedPoint.lat.toFixed(4)},${selectedPoint.lon.toFixed(4)}` : ""
  useEffect(() => {
    if (alertLatitude == null || alertLongitude == null) return
    let cancelled = false
    const load = async () => {
      const params = new URLSearchParams({ latitude: String(alertLatitude), longitude: String(alertLongitude) })
      try {
        const next = await fetchForecast<OfficialAlertResponse>(config, `alerts?${params}`)
        if (!cancelled) { setAlertSnapshot({ key: `${alertLatitude.toFixed(4)},${alertLongitude.toFixed(4)}`, value: next }); setAlertError("") }
      } catch {
        if (!cancelled) setAlertError("Official alert check failed; last received alerts may be stale.")
      }
    }
    const initial = window.setTimeout(() => void load(), 0)
    const timer = window.setInterval(() => void load(), 60_000)
    return () => { cancelled = true; window.clearTimeout(initial); window.clearInterval(timer) }
  }, [config, alertLatitude, alertLongitude])

  const sources = useMemo(() => parseProducerSources(status?.streaming), [status?.streaming])
  const alerts = alertSnapshot?.key === alertKey ? alertSnapshot.value : null
  const selected = chooseProducerSource(sources, manualSourceId)
  const generatedAt = status?.generated_at ? Date.parse(status.generated_at) : 0
  const statusFresh = !statusError && statusCheckedAt > 0 && now - statusCheckedAt < 60_000 && generatedAt > 0 && now - generatedAt < 60_000
  const playing = statusFresh && selected?.publisherOnline && selected.playerUrl
  const units = state.fabric.units?.units ?? []

  const selectSource = (id: string) => {
    setManualSourceId(id)
    try { localStorage.setItem(SELECTION_KEY, id) } catch { /* Selection remains for this session. */ }
  }

  return <main className="workspace-page producer-workspace">
    <header className="workspace-heading"><div><h1>Producer</h1><p>Live stream control desk</p></div><button type="button" onClick={() => void refreshStatus()}>Refresh sources</button></header>
    <div className="producer-layout">
      <div className="producer-main">
        <section className="workspace-panel producer-stage" aria-label="Selected live stream camera">
          <header><h2>Live camera</h2><span className={playing ? "workspace-live" : "workspace-muted"}>{playing ? "PUBLISHING" : statusError ? "STATUS UNAVAILABLE" : "NO LIVE PUBLISHER"}</span></header>
          <div className="producer-stage__viewport">
            {playing ? <iframe key={selected.id} title={`${selected.name} live stream`} src={selected.playerUrl!} allow="autoplay; fullscreen" allowFullScreen referrerPolicy="no-referrer" /> :
              <div className="producer-stage__standby"><strong>{selected ? `${selected.name} is not publishing` : "No field stream sources reported"}</strong><p>{statusError || selected?.reason || "Waiting for source telemetry from Core."}</p></div>}
          </div>
          <div className="producer-stage__foot"><div><strong>{selected?.name ?? "NO SOURCE"}</strong><span>{statusFresh ? `Core source check ${age(statusCheckedAt, now)}` : "Source status stale or unavailable"}</span></div>{selected?.playerUrl && <a href={selected.playerUrl} target="_blank" rel="noreferrer">Open private player ↗</a>}</div>
        </section>
        <section className="workspace-panel producer-sources" aria-label="Live stream camera sources"><header><h2>Camera sources</h2><span>{sources.filter((source) => source.publisherOnline).length} publishing</span></header>
          <div className="producer-sources__rail">{sources.map((source) => <button type="button" key={source.id} className={selected?.id === source.id ? "is-selected" : ""} aria-pressed={selected?.id === source.id} onClick={() => selectSource(source.id)}><span className={statusFresh && source.publisherOnline ? "workspace-dot workspace-dot--live" : "workspace-dot"} /><strong>{source.name}</strong><small>{!statusFresh ? "STATUS STALE" : source.publisherOnline ? "PUBLISHING" : source.state}</small></button>)}{sources.length === 0 && <p>Source inventory unavailable. The Producer desk does not substitute road cameras for field streams.</p>}</div>
          <p className="workspace-note">These are the STRIKER and TESSA live-stream feeds. Road cameras remain on the operations map as supporting context. Playback currently requires access to Core’s private Tailscale player; being signed into OPS alone does not grant media access.</p>
        </section>
        <section className="workspace-panel producer-map-link"><header><h2>Situation map</h2><Link to="/">Expand map ↗</Link></header><ProducerSituationMap selectedPoint={selectedPoint} units={units} onPointSelect={selectPoint} /><p>{selectedPoint ? `Selected point ${selectedPoint.lat.toFixed(3)}, ${selectedPoint.lon.toFixed(3)} · official alerts in the rail.` : "Select a point to check official alerts."} Radar and road cameras remain in Operations Map.</p><Link to="/radar">Open single-site radar ↗</Link></section>
      </div>
      <aside className="producer-rail">
        <section className="workspace-panel"><header><h2>Team</h2><Link to="/chase">Fleet ↗</Link></header><div className="workspace-list">{units.length === 0 ? <p>No Fabric units reported.</p> : units.map((unit) => <div key={unit.unit_id}><strong>{unit.operator_name || unit.display_name}</strong><span>{unit.overall_health} · {age(unit.last_seen, now)}</span></div>)}</div></section>
        <section className="workspace-panel"><header><h2>Official alerts</h2><Link to="/weather">Weather ↗</Link></header>{alertError && <p className="workspace-warning">{alertError}</p>}{!selectedPoint ? <p>Select a map point to check official alerts for that area.</p> : alerts?.alerts.length ? <div className="workspace-list">{alerts.alerts.slice(0, 4).map((alert, index) => <div key={alert.id ?? index}><strong>{alert.event || alert.headline || "Official alert"}</strong><span>{alert.severity || "NWS"}{alert.expires ? ` · ${expiry(alert.expires, now)}` : ""}</span></div>)}</div> : <p>{alerts ? "No active alerts returned for the selected point." : "Checking NWS alerts…"}</p>}</section>
        <section className="workspace-panel"><header><h2>Aegis · internal</h2><Link to="/aegis-alerts">Review ↗</Link></header><p>Radar findings are advisory and separate from official warnings. Team-wide delivery remains behind the review policy.</p></section>
        <section className="workspace-panel"><header><h2>Broadcast health</h2><Link to="/stream">Streams ↗</Link></header><p>{statusError || (status?.streaming as { summary?: string } | undefined)?.summary || "Checking stream infrastructure…"}</p></section>
      </aside>
    </div>
  </main>
}
