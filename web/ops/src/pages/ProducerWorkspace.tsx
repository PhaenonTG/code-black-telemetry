import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { PageHeader } from "../components/PageHeader"
import { Link } from "react-router-dom"
import { useCoreOps } from "../core/useCoreOps"
import { currentAccessToken, fetchForecast } from "../core/client"
import { fetchStatusCenter, type StatusCenterDocument } from "../status/statusCenterClient"
import { chooseProducerSource, parseProducerSources } from "../workspaces/producerSources"
import { ProducerSituationMap } from "../workspaces/ProducerSituationMap"
import FacebookProducerPanel from "../workspaces/FacebookProducerPanel"
import ProducerControls from "../workspaces/ProducerControls"
import PreparePcControls from "../workspaces/PreparePcControls"
import ProgramMonitor from "../workspaces/ProgramMonitor"
import { currentMediaTimestamp, currentProgramRender, mediaCompositionMatches, PROGRAM_PREVIEW_POLL_MS, PROGRAM_STATUS_POLL_MS } from "../workspaces/programMonitorPolicy"
import { useProducerRead } from "../workspaces/useProducerRead"
import { createProducerPoll } from "../workspaces/producerPolling"
import { readProducerResponse } from "../workspaces/producerResponse"
import { noteProducerResponse, producerReadAllowed, producerRetryMessage } from "../workspaces/producerRateLimit"
import "./Workspaces.css"

const SELECTION_KEY = "codeblack.ops.producer.source.v1"
type OfficialAlert = { id?: string; event?: string; headline?: string; severity?: string; expires?: string }
type OfficialAlertResponse = { status: string; alerts: OfficialAlert[]; queried_at?: string }
type ProducerPreview = { state?: string; available?: boolean }
type ProducerBridgeStatus = {
  engine?: string
  composition?: { id?: string }
  program?: { state?: string; compositionId?: string; generation?: string; lastFrameAt?: string }
  observedAt?: string
  bridgeState?: string
  bridge_state?: string
  bridge?: string | { state?: string; lastSuccessAt?: string }
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
  const state = document?.bridgeState ?? document?.bridge_state ?? (typeof document?.bridge === "string" ? document.bridge : document?.bridge?.state)
  if (typeof state === "string" && state.trim()) return state.toUpperCase()
  return document?.observedAt ? "ONLINE" : "OFFLINE"
}

function unwrapBridgeStatus(document: ProducerBridgeStatus): ProducerBridgeStatus {
  const status = document.status && typeof document.status === "object" ? document.status : document
  return { ...status, observedAt: status.observedAt ?? document.observedAt, bridgeState: bridgeState(document) }
}

function sourceFresh(document: ProducerBridgeStatus | null): boolean {
  return currentProgramRender(document)
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
  const [producerError, setProducerError] = useState("")
  const [programFrameUrl, setProgramFrameUrl] = useState("")
  const [programFrameAt, setProgramFrameAt] = useState("")
  const [programFrameState, setProgramFrameState] = useState("Waiting for broadcaster status")
  const [programFrameComposition, setProgramFrameComposition] = useState<string | undefined>()
  const programObjectUrl = useRef("")
  const producerStatusRef = useRef<ProducerBridgeStatus | null>(null)
  useEffect(() => { producerStatusRef.current = producerStatus }, [producerStatus])

  const statusRead = useProducerRead()
  const refreshStatus = useCallback(async () => {
    if (document.hidden) return
    await statusRead.run(signal => fetchStatusCenter(config, { signal }), next => {
      setStatus(next); setStatusCheckedAt(Date.now()); setStatusError("")
    }, reason => setStatusError(reason instanceof Error ? reason.message : "Stream status unavailable"))
  }, [config, statusRead])

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshStatus(), 0)
    const timer = window.setInterval(() => void refreshStatus(), 20_000)
    const clock = window.setInterval(() => setNow(Date.now()), 15_000)
    const visible = () => { if (!document.hidden) void refreshStatus() }
    document.addEventListener("visibilitychange", visible)
    return () => { statusRead.cancel(); window.clearTimeout(initial); window.clearInterval(timer); window.clearInterval(clock); document.removeEventListener("visibilitychange", visible) }
  }, [refreshStatus, statusRead])

  const alertLatitude = selectedPoint?.lat
  const alertLongitude = selectedPoint?.lon
  const alertKey = selectedPoint ? `${selectedPoint.lat.toFixed(4)},${selectedPoint.lon.toFixed(4)}` : ""
  useEffect(() => {
    if (alertLatitude == null || alertLongitude == null) return
    const poll = createProducerPoll()
    const load = async () => {
      if (document.hidden) return
      const params = new URLSearchParams({ latitude: String(alertLatitude), longitude: String(alertLongitude) })
      // fetchForecast keeps the shared read cache and its own bounded timeout; the lane adds abort + deadline.
      await poll.run(signal => fetchForecast<OfficialAlertResponse>(config, `alerts?${params}`, signal), next => { setAlertSnapshot({ key: `${alertLatitude.toFixed(4)},${alertLongitude.toFixed(4)}`, value: next }); setAlertError("") }, () => setAlertError("Official alert check failed; last received alerts may be stale."), 25_000)
    }
    const initial = window.setTimeout(() => void load(), 0)
    const timer = window.setInterval(() => void load(), 60_000)
    return () => { poll.dispose(); window.clearTimeout(initial); window.clearInterval(timer) }
  }, [config, alertLatitude, alertLongitude])

  useEffect(() => {
    const poll = createProducerPoll()
    let inFlight = false
    const load = async () => {
      if (document.hidden || inFlight || !producerReadAllowed()) return
      inFlight = true
      try { await poll.run(async signal => {
        const token = await currentAccessToken()
        signal.throwIfAborted()
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
        const response = await fetch("/api/producer/v1/status", { cache: "no-store", headers, signal })
        return readProducerResponse<ProducerBridgeStatus>(response)
      }, next => { setProducerStatus(unwrapBridgeStatus(next)); setProducerError("") }, reason => setProducerError(reason instanceof Error ? reason.message : "Producer bridge unavailable")) } finally { inFlight = false }
    }
    void load()
    const timer = window.setInterval(() => void load(), PROGRAM_STATUS_POLL_MS)
    const visible = () => { if (!document.hidden) void load() }
    document.addEventListener("visibilitychange", visible)
    return () => { poll.dispose(); window.clearInterval(timer); document.removeEventListener("visibilitychange", visible) }
  }, [])

  useEffect(() => {
    const poll = createProducerPoll()
    let inFlight = false
    const clearFrame = () => {
      if (programObjectUrl.current) URL.revokeObjectURL(programObjectUrl.current)
      programObjectUrl.current = ""
    }
    const load = async () => {
      if (document.hidden || inFlight) return
      if (!producerReadAllowed()) { setProgramFrameState(producerRetryMessage()); return }
      const currentStatus = producerStatusRef.current
      if (!sourceFresh(currentStatus)) { setProgramFrameState(currentStatus ? "Waiting for current PROGRAM rendering" : "Waiting for broadcaster status"); return }
      inFlight = true
      try {
        await poll.run(async signal => {
          const token = await currentAccessToken()
          signal.throwIfAborted()
          const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
          const response = await fetch(`/api/producer/v1/preview/program.jpg?t=${Date.now()}`, { cache: "no-store", headers, signal })
          signal.throwIfAborted()
          noteProducerResponse(response)
          if (response.status === 429) throw new Error(producerRetryMessage())
          if (response.status === 404) throw new Error("No current PROGRAM frame")
          if (!response.ok) throw new Error(`Preview returned ${response.status}`)
          const frameAt = response.headers.get("X-Producer-Frame-At") ?? ""
          const frameComposition = response.headers.get("X-Producer-Composition")
          if (!currentMediaTimestamp(frameAt)) throw new Error("PROGRAM frame is stale")
          if (!mediaCompositionMatches(currentStatus?.composition?.id, frameComposition)) throw new Error("PROGRAM composition mismatch")
          const blob = await response.blob()
          signal.throwIfAborted()
          if (producerStatusRef.current?.composition?.id !== currentStatus?.composition?.id) throw new Error("PROGRAM changed during capture")
          if (!sourceFresh(producerStatusRef.current)) throw new Error("Waiting for current PROGRAM rendering")
          const nextUrl = URL.createObjectURL(blob)
          // Release pending decode URLs on deadline/cleanup as well as on decode failure.
          const revoke = () => URL.revokeObjectURL(nextUrl)
          signal.addEventListener("abort", revoke, { once: true })
          try {
            const preload = new Image(); preload.src = nextUrl; await preload.decode()
            signal.throwIfAborted()
            if (producerStatusRef.current?.composition?.id !== currentStatus?.composition?.id) throw new Error("PROGRAM changed during capture")
            return { nextUrl, frameAt, composition: currentStatus?.composition?.id }
          } catch (reason) { revoke(); throw reason }
          finally { signal.removeEventListener("abort", revoke) }
        }, next => {
          const previousUrl = programObjectUrl.current
          programObjectUrl.current = next.nextUrl
          setProgramFrameUrl(next.nextUrl); setProgramFrameAt(next.frameAt); setProgramFrameComposition(next.composition); setProgramFrameState("CURRENT")
          if (previousUrl) window.setTimeout(() => URL.revokeObjectURL(previousUrl), 2000)
        }, reason => {
          if (reason instanceof Error && reason.message === "PROGRAM composition mismatch") { clearFrame(); setProgramFrameUrl("") }
          setProgramFrameState(reason instanceof Error ? reason.message : "PROGRAM preview unavailable")
        })
      } finally { inFlight = false }
    }
    void load()
    const timer = window.setInterval(() => void load(), PROGRAM_PREVIEW_POLL_MS)
    const visible = () => { if (!document.hidden) void load() }
    document.addEventListener("visibilitychange", visible)
    return () => { poll.dispose(); window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); clearFrame() }
  }, [producerStatus?.composition?.id])

  const sources = useMemo(() => parseProducerSources(status?.streaming), [status?.streaming])
  const alerts = alertSnapshot?.key === alertKey ? alertSnapshot.value : null
  const selected = chooseProducerSource(sources, manualSourceId)
  const generatedAt = status?.generated_at ? Date.parse(status.generated_at) : 0
  const statusFresh = !statusError && statusCheckedAt > 0 && now - statusCheckedAt < 60_000 && generatedAt > 0 && now - generatedAt < 60_000
  const playing = statusFresh && selected?.publisherOnline && selected.playerUrl
  const units = state.fabric.units?.units ?? []
  const producerBridgeState = bridgeState(producerStatus)
  const programCurrent = programFrameState === "CURRENT" && sourceFresh(producerStatus) && programFrameComposition === producerStatus?.composition?.id && Boolean(programFrameUrl) && Boolean(currentMediaTimestamp(programFrameAt))
  const heldFrameAge = Date.now() - Date.parse(programFrameAt)
  const heldFrame = Boolean(programFrameUrl) && programFrameComposition === producerStatus?.composition?.id && Number.isFinite(heldFrameAge) && heldFrameAge >= -2000 && heldFrameAge <= 30_000
  const programStateLabel = programCurrent ? "CURRENT" : producerBridgeState === "ONLINE" && producerStatus?.engine === "obs" ? sourceFresh(producerStatus) ? "OBS PROGRAM READY" : "WAITING FOR PROGRAM" : producerBridgeState === "ONLINE" && producerStatus?.source_state !== "SOURCE_LIVE" ? "RELAY READY · WAITING FOR SOURCE" : producerBridgeState

  const selectSource = (id: string) => {
    setManualSourceId(id)
    try { localStorage.setItem(SELECTION_KEY, id) } catch { /* Selection remains for this session. */ }
  }

  return <section className="workspace-page producer-workspace">
    <PageHeader className="workspace-heading" kicker="STREAM · PROGRAM CONTROL" title="Producer" description="Live stream control desk" actions={<button type="button" onClick={() => void refreshStatus()}>Refresh sources</button>} />
    <div className="producer-layout">
      <div className="producer-main">
        <section className="workspace-panel producer-stage" aria-label="PROGRAM preview">
          <header><h2>PROGRAM</h2><span className={programCurrent || producerBridgeState === "ONLINE" ? "workspace-live" : "workspace-muted"}>{programStateLabel}</span></header>
          <ProgramMonitor key={producerStatus?.composition?.id ?? "legacy"} active={producerBridgeState === "ONLINE" && Boolean(producerStatus?.composition?.id)} canStart={sourceFresh(producerStatus)} compositionId={producerStatus?.composition?.id} fallback={heldFrame ? <><img src={programFrameUrl} alt={programCurrent ? "Current PROGRAM preview" : "Last verified PROGRAM frame"} />{!programCurrent && <span className="producer-stage__held-label">LAST VERIFIED FRAME · awaiting fresh PROGRAM proof</span>}</> : <div className="producer-stage__standby"><strong>{programFrameState}</strong><p>{producerError || (producerStatus?.source_state ? `Source: ${producerStatus.source_state} · Preview: ${producerStatus.previews?.program?.state ?? "UNKNOWN"}` : "The authenticated broadcaster bridge has not supplied a current frame.")}</p></div>} />
          <div className="producer-stage__foot"><div><strong>{producerStatus?.state ?? "NO BROADCASTER STATUS"}</strong><span>{programCurrent && programFrameAt ? `Frame ${age(programFrameAt, now)}` : `Bridge ${producerBridgeState}`}</span></div><span>{producerStatus?.broadcast?.state ?? "OUTPUT UNKNOWN"}</span></div>
        </section>
        <PreparePcControls />
        <ProducerControls />
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
        <section className="workspace-panel producer-map-link"><header><h2>Situation map</h2><Link to="/">Operations map →</Link></header><ProducerSituationMap selectedPoint={selectedPoint} units={units} onPointSelect={selectPoint} /><p>{selectedPoint ? `Selected point ${selectedPoint.lat.toFixed(3)}, ${selectedPoint.lon.toFixed(3)} · official alerts in the rail.` : "Select a point to check official alerts."} Radar and road cameras remain in Operations Map.</p><Link to="/radar">Open single-site radar →</Link></section>
      </div>
      <aside className="producer-rail">
        <section className="workspace-panel"><header><h2>Team</h2><Link to="/chase">Team & devices →</Link></header><div className="workspace-list">{units.length === 0 ? <p>No Fabric units reported.</p> : units.map((unit) => <div key={unit.unit_id}><strong>{unit.operator_name || unit.display_name}</strong><span>{unit.overall_health} · {age(unit.last_seen, now)}</span></div>)}</div></section>
        <section className="workspace-panel"><header><h2>Official alerts</h2><Link to="/weather">Weather analysis →</Link></header>{alertError && <p className="workspace-warning">{alertError}</p>}{!selectedPoint ? <p>Select a map point to check official alerts for that area.</p> : alerts?.alerts.length ? <div className="workspace-list">{alerts.alerts.slice(0, 4).map((alert, index) => <div key={alert.id ?? index}><strong>{alert.event || alert.headline || "Official alert"}</strong><span>{alert.severity || "NWS"}{alert.expires ? ` · ${expiry(alert.expires, now)}` : ""}</span></div>)}</div> : <p>{alerts ? "No active alerts returned for the selected point." : "Checking NWS alerts…"}</p>}</section>
        <section className="workspace-panel"><header><h2>Aegis · internal</h2><Link to="/aegis-alerts">Aegis alerts →</Link></header><p>Radar findings are advisory and separate from official warnings. Team-wide delivery remains behind the review policy.</p></section>
        <section className="workspace-panel"><header><h2>Broadcast health</h2><Link to="/stream">Program status →</Link></header><p>{statusError || (status?.streaming as { summary?: string } | undefined)?.summary || "Checking stream infrastructure…"}</p></section>
        <FacebookProducerPanel />
      </aside>
    </div>
  </section>
}
