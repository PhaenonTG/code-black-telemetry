import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { useCoreOps } from "../core/useCoreOps"
import { currentAccessToken, fetchForecast } from "../core/client"
import { fetchStatusCenter, type StatusCenterDocument } from "../status/statusCenterClient"
import { chooseProducerSource, parseProducerSources } from "../workspaces/producerSources"
import { ProducerSituationMap } from "../workspaces/ProducerSituationMap"
import FacebookProducerPanel from "../workspaces/FacebookProducerPanel"
import "./Workspaces.css"

const SELECTION_KEY = "codeblack.ops.producer.source.v1"
type OfficialAlert = { id?: string; event?: string; headline?: string; severity?: string; expires?: string }
type OfficialAlertResponse = { status: string; alerts: OfficialAlert[]; queried_at?: string }
type ProducerPreview = { state?: string; available?: boolean }
type ProducerBridgeStatus = {
  observedAt?: string
  bridgeState?: string
  bridge_state?: string
  bridge?: { state?: string; lastSuccessAt?: string }
  status?: ProducerBridgeStatus
  state?: string
  stateRevision?: number
  source_state?: string
  transport_state?: string
  previews?: { program?: ProducerPreview }
  metrics?: { last_video_timestamp?: string | null }
  broadcast?: { state?: string; configured?: boolean; enabled?: boolean }
  audio?: { available?: boolean; silence?: boolean; clipping?: boolean }
  lastError?: string | null
}
type ProducerCapabilities = { schemaVersion?: string; actions?: Record<string, string[]>; unavailable?: Record<string, string>; capabilities?: ProducerCapabilities }

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

function bridgeState(document: ProducerBridgeStatus | null): string {
  const state = document?.bridgeState ?? document?.bridge_state ?? document?.bridge?.state ?? document?.status?.bridgeState ?? document?.status?.bridge_state ?? document?.status?.bridge?.state
  if (typeof state === "string" && state.trim()) return state.toUpperCase()
  return document?.observedAt ? "ONLINE" : "OFFLINE"
}

function unwrapBridgeStatus(document: ProducerBridgeStatus): ProducerBridgeStatus {
  const status = document.status && typeof document.status === "object" ? document.status : document
  return { ...status, observedAt: document.observedAt ?? status.observedAt, bridgeState: document.bridgeState ?? document.bridge_state ?? document.bridge?.state ?? status.bridgeState ?? status.bridge_state ?? status.bridge?.state }
}

function unwrapCapabilities(document: ProducerCapabilities): ProducerCapabilities {
  return document.capabilities && typeof document.capabilities === "object" ? document.capabilities : document
}

function sourceFresh(document: ProducerBridgeStatus | null): boolean {
  return document?.source_state === "SOURCE_LIVE" && document?.previews?.program?.state === "ACTIVE"
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
  const [producerStatus, setProducerStatus] = useState<ProducerBridgeStatus | null>(null)
  const [producerCapabilities, setProducerCapabilities] = useState<ProducerCapabilities | null>(null)
  const [producerError, setProducerError] = useState("")
  const [programFrameUrl, setProgramFrameUrl] = useState("")
  const [programFrameAt, setProgramFrameAt] = useState("")
  const [programFrameState, setProgramFrameState] = useState("Waiting for broadcaster status")
  const programObjectUrl = useRef("")

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

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const token = await currentAccessToken()
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
        const [statusResponse, capabilitiesResponse] = await Promise.all([
          fetch("/api/producer/v1/status", { cache: "no-store", headers }),
          fetch("/api/producer/v1/capabilities", { cache: "no-store", headers }),
        ])
        if (!statusResponse.ok || !capabilitiesResponse.ok) throw new Error(`Producer bridge returned ${!statusResponse.ok ? statusResponse.status : capabilitiesResponse.status}`)
        const [nextStatus, nextCapabilities] = await Promise.all([
          statusResponse.json() as Promise<ProducerBridgeStatus>, capabilitiesResponse.json() as Promise<ProducerCapabilities>,
        ])
        if (cancelled) return
        setProducerStatus(unwrapBridgeStatus(nextStatus)); setProducerCapabilities(unwrapCapabilities(nextCapabilities)); setProducerError("")
      } catch (reason) {
        if (!cancelled) { setProducerStatus(null); setProducerCapabilities(null); setProducerError(reason instanceof Error ? reason.message : "Producer bridge unavailable") }
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 4_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [])

  useEffect(() => {
    let cancelled = false
    const clearFrame = () => {
      if (programObjectUrl.current) URL.revokeObjectURL(programObjectUrl.current)
      programObjectUrl.current = ""
      setProgramFrameUrl("")
    }
    const load = async () => {
      if (!sourceFresh(producerStatus)) { clearFrame(); setProgramFrameState(producerStatus ? "PROGRAM unavailable until the source is live" : "Waiting for broadcaster status"); return }
      try {
        const token = await currentAccessToken()
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
        const response = await fetch(`/api/producer/v1/preview/program.jpg?t=${Date.now()}`, { cache: "no-store", headers })
        if (response.status === 404) { clearFrame(); setProgramFrameState("No current PROGRAM frame"); return }
        if (!response.ok) throw new Error(`Preview returned ${response.status}`)
        const frameAt = response.headers.get("X-Producer-Frame-At") ?? ""
        const frameTime = Date.parse(frameAt)
        if (!Number.isFinite(frameTime) || Date.now() - frameTime > 5_000) { clearFrame(); setProgramFrameState("PROGRAM frame is stale"); return }
        const blob = await response.blob()
        if (cancelled) return
        const nextUrl = URL.createObjectURL(blob)
        if (programObjectUrl.current) URL.revokeObjectURL(programObjectUrl.current)
        programObjectUrl.current = nextUrl
        setProgramFrameUrl(nextUrl); setProgramFrameAt(frameAt); setProgramFrameState("CURRENT")
      } catch (reason) {
        if (!cancelled) { clearFrame(); setProgramFrameState(reason instanceof Error ? reason.message : "PROGRAM preview unavailable") }
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 1_500)
    return () => { cancelled = true; window.clearInterval(timer); clearFrame() }
  }, [producerStatus?.source_state, producerStatus?.previews?.program?.state])

  const sources = useMemo(() => parseProducerSources(status?.streaming), [status?.streaming])
  const alerts = alertSnapshot?.key === alertKey ? alertSnapshot.value : null
  const selected = chooseProducerSource(sources, manualSourceId)
  const generatedAt = status?.generated_at ? Date.parse(status.generated_at) : 0
  const statusFresh = !statusError && statusCheckedAt > 0 && now - statusCheckedAt < 60_000 && generatedAt > 0 && now - generatedAt < 60_000
  const playing = statusFresh && selected?.publisherOnline && selected.playerUrl
  const units = state.fabric.units?.units ?? []
  const producerBridgeState = bridgeState(producerStatus)
  const programCurrent = programFrameState === "CURRENT" && sourceFresh(producerStatus) && Boolean(programFrameUrl)
  const controlActions = Object.entries(producerCapabilities?.actions ?? {}).flatMap(([group, actions]) => actions.map((action) => `${group}.${action}`))

  const selectSource = (id: string) => {
    setManualSourceId(id)
    try { localStorage.setItem(SELECTION_KEY, id) } catch { /* Selection remains for this session. */ }
  }

  return <main className="workspace-page producer-workspace">
    <header className="workspace-heading"><div><h1>Producer</h1><p>Live stream control desk</p></div><button type="button" onClick={() => void refreshStatus()}>Refresh sources</button></header>
    <div className="producer-layout">
      <div className="producer-main">
        <section className="workspace-panel producer-stage" aria-label="PROGRAM preview">
          <header><h2>PROGRAM</h2><span className={programCurrent ? "workspace-live" : "workspace-muted"}>{programCurrent ? "CURRENT" : producerBridgeState}</span></header>
          <div className="producer-stage__viewport">
            {programCurrent ? <img src={programFrameUrl} alt="Current PROGRAM preview" /> : <div className="producer-stage__standby"><strong>{programFrameState}</strong><p>{producerError || (producerStatus?.source_state ? `Source: ${producerStatus.source_state} · Preview: ${producerStatus.previews?.program?.state ?? "UNKNOWN"}` : "The authenticated broadcaster bridge has not supplied a current frame.")}</p></div>}
          </div>
          <div className="producer-stage__foot"><div><strong>{producerStatus?.state ?? "NO BROADCASTER STATUS"}</strong><span>{programCurrent && programFrameAt ? `Frame ${age(programFrameAt, now)}` : `Bridge ${producerBridgeState}`}</span></div><span>{producerStatus?.broadcast?.state ?? "OUTPUT UNKNOWN"}</span></div>
        </section>
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
        <FacebookProducerPanel />
        <section className="workspace-panel"><header><h2>PROGRAM controls</h2><span className={producerBridgeState === "ONLINE" ? "workspace-live" : "workspace-muted"}>{producerBridgeState}</span></header><p>{producerError || (producerCapabilities ? `Bridge schema ${producerCapabilities.schemaVersion ?? "unknown"}.` : "Waiting for authenticated capability report.")}</p>{controlActions.length ? <div className="workspace-list">{controlActions.map((action) => <div key={action}><strong>{action}</strong><span>CONTROL ACCESS PENDING</span></div>)}</div> : <p className="workspace-note">No producer actions have been reported yet.</p>}<p className="workspace-note">Remote stream commands remain pending the producer confirmation flow. Facebook connection and comment replies are managed separately above.</p></section>
      </aside>
    </div>
  </main>
}
