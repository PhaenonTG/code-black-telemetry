import { useCallback, useEffect, useRef, useState } from "react"
import { currentAccessToken } from "../core/client"

type Status = { bridge: string; controlAccess?: { allowed: boolean; userId: string }; controlLease?: { userId: string; operator: string; expiresAt: number } | null; status?: { stateRevision: number; source_state?: string; broadcast?: { state?: string; managedVideoId?: string | null }; audio?: { available?: boolean; silence?: boolean; clipping?: boolean } } }
type Lifecycle = { enabled: boolean; permission: boolean; canManage: boolean; broadcast: { id: string; title: string; description: string; status: string; facebookProducerUrl: string } | null; operation?: { state: string; action: string } | null }
type Command = { commandId: string; state: string; result?: { error?: string } }
async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const token = await currentAccessToken()
  if (!token) throw new Error("Sign in to OPS again.")
  const response = await fetch(`/api/producer/v1/${path}`, { method, cache: "no-store", headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000) })
  const data = await response.json()
  if (!response.ok) throw new Error(`${data.error || `HTTP ${response.status}`}${typeof data.code === "number" ? ` (Meta ${data.code})` : ""}`)
  return data as T
}

export default function ProducerControls() {
  const [status, setStatus] = useState<Status | null>(null)
  const [message, setMessage] = useState("")
  const [pending, setPending] = useState<Command | null>(null)
  const [confirmStart, setConfirmStart] = useState(false)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [facebook, setFacebook] = useState<Lifecycle | null>(null)
  const [facebookError, setFacebookError] = useState("")
  const [title, setTitle] = useState("Storm Chaser Nick Mounce — Live")
  const [description, setDescription] = useState("")
  const [confirmFacebook, setConfirmFacebook] = useState<"prepare" | "publish" | "end" | null>(null)
  const [programConfirmed, setProgramConfirmed] = useState(false)
  const [checkedAt, setCheckedAt] = useState(() => Date.now())
  const renewing = useRef(false)
  const owner = Boolean(status?.controlLease && status.controlLease.expiresAt > checkedAt && status.controlLease.userId === status.controlAccess?.userId)
  const online = status?.bridge === "ONLINE"
  const allowed = status?.controlAccess?.allowed === true
  const refresh = useCallback(async () => { try { setStatus(await api<Status>("status")); setCheckedAt(Date.now()) } catch (error) { setStatus(null); setMessage(String(error instanceof Error ? error.message : error)) } }, [])
  useEffect(() => { const initial = window.setTimeout(() => void refresh(), 0); const timer = window.setInterval(() => void refresh(), 3_000); return () => { window.clearTimeout(initial); window.clearInterval(timer) } }, [refresh])
  const refreshFacebook = useCallback(async () => { try { setFacebook(await api<Lifecycle>("facebook")); setFacebookError("") } catch (error) { setFacebookError(error instanceof Error ? error.message : "Facebook management unavailable") } }, [])
  useEffect(() => { const initial = window.setTimeout(() => void refreshFacebook(), 0); const timer = window.setInterval(() => void refreshFacebook(), 5_000); return () => { window.clearTimeout(initial); window.clearInterval(timer) } }, [refreshFacebook])
  useEffect(() => {
    if (!owner) return
    const timer = window.setInterval(async () => {
      if (renewing.current || document.visibilityState !== "visible") return
      renewing.current = true
      try { await api("control-lease", "POST"); await refresh() } catch { setMessage("Control lease lost. Take control again before sending commands.") } finally { renewing.current = false }
    }, 10_000)
    return () => window.clearInterval(timer)
  }, [owner, refresh])
  useEffect(() => {
    if (!pending || pending.state !== "queued") return
    const started = Date.now()
    const timer = window.setInterval(async () => {
      try {
        const next = await api<Command>(`commands/${pending.commandId}`)
        if (next.state !== "queued") { setPending(next); setMessage(`${next.state.toUpperCase()}${next.result?.error ? `: ${next.result.error}` : " — check live status below."}`); void refresh() }
        else if (Date.now() - started > 20_000) { setPending({ ...next, state: "unknown" }); setMessage("Delivery unconfirmed. Check output status before trying another start command.") }
      } catch { if (Date.now() - started > 20_000) { setPending({ ...pending, state: "unknown" }); setMessage("Delivery unconfirmed. Connection lost; check status before retrying.") } }
    }, 1_500)
    return () => window.clearInterval(timer)
  }, [pending, refresh])
  async function lease(release = false) { setBusy(true); try { await api("control-lease", release ? "DELETE" : "POST"); setMessage(release ? "Control released." : "You have control."); await refresh() } catch (error) { setMessage(error instanceof Error ? error.message : "Control unavailable") } finally { setBusy(false) } }
  async function command(action: string, confirmed = false) {
    setBusy(true); setConfirmStart(false)
    try {
      const latest = await api<Status>("status"); setStatus(latest)
      if (!Number.isSafeInteger(latest.status?.stateRevision)) throw new Error("No current broadcaster revision.")
      const next = await api<Command>("commands", "POST", { commandId: crypto.randomUUID(), action, expectedStateRevision: latest.status!.stateRevision, confirmed, ...(action === "lowerThird.set" ? { payload: { text: text.trim() } } : action === "facebook.output.start" && facebook?.broadcast ? { payload: { videoId: facebook.broadcast.id } } : {}) })
      setPending(next); setMessage("QUEUED — waiting for broadcaster acknowledgment.")
    } catch (error) { setMessage(error instanceof Error ? error.message : "Command delivery unknown; check status before retrying.") } finally { setBusy(false) }
  }
  async function facebookAction(action: "prepare" | "publish" | "end" | "refresh") {
    setBusy(true); setConfirmFacebook(null)
    try {
      await api(`facebook/${action}`, "POST", { requestId: crypto.randomUUID(), confirmed: true, videoId: facebook?.broadcast?.id, title: title.trim(), description, programConfirmed })
      setMessage(action === "prepare" ? "Non-public broadcast prepared. Wait for the encoder destination to synchronize, then send PROGRAM to Facebook preview." : action === "refresh" ? "Facebook status checked." : `${action.toUpperCase()} acknowledged by Meta. Check Facebook status to confirm the final state.`)
    } catch (error) { setMessage(error instanceof Error && !["TypeError", "TimeoutError", "AbortError"].includes(error.name) ? error.message : "Meta delivery unconfirmed. Do not retry; check Facebook directly before taking another action.") }
    finally { setBusy(false); setProgramConfirmed(false); void refreshFacebook(); void refresh() }
  }
  const blocked = busy || pending?.state === "queued"
  const canStart = owner && online && !blocked
  const managed = facebook?.broadcast
  const managedTerminal = managed && ["LIVE_STOPPED", "PROCESSING", "VOD", "ENDED", "SCHEDULED_CANCELED"].includes(managed.status)
  const managedEnding = managed?.status === "END_REQUESTED"
  const managedSynced = !managed || status?.status?.broadcast?.managedVideoId === managed.id
  const unresolved = facebook?.operation?.state === "pending" || facebook?.operation?.state === "unknown"
  const audioHealthy = status?.status?.audio?.available === true && !status.status.audio.silence && !status.status.audio.clipping
  return <section className="workspace-panel producer-controls" aria-label="PROGRAM controls">
    <header><h2>PROGRAM controls</h2><span className={online ? "workspace-live" : "workspace-muted"}>{online ? "ONLINE" : "OFFLINE"}</span></header>
    <p>{owner ? "You have control. Lease renews while this tab is visible." : status?.controlLease && status.controlLease.expiresAt > checkedAt ? `Controlled by ${status.controlLease.operator}` : "No operator holds control."}</p>
    <button type="button" disabled={!allowed || busy || (!owner && !online)} onClick={() => void lease(owner)}>{owner ? "Release control" : "Take control"}</button>
    {!allowed && <p className="workspace-note">Controls are restricted to approved producer accounts and must be enabled by the gateway.</p>}
    <div className="producer-controls__grid">
      <button type="button" disabled={!canStart} onClick={() => void command("preview.start")}>Arm / recover preview</button>
      <button type="button" disabled={!allowed} onClick={() => void command("preview.stop")}>Stop preview + output</button>
      <button type="button" disabled={!canStart || status?.status?.source_state !== "SOURCE_LIVE" || !audioHealthy || !managedSynced || Boolean(managedTerminal) || managedEnding || unresolved} onClick={() => setConfirmStart(true)}>{managed ? "Send to Facebook preview…" : "Start Facebook output…"}</button>
      <button type="button" disabled={!allowed} onClick={() => void command("facebook.output.stop")}>STOP Facebook output</button>
      <button type="button" disabled={!canStart} onClick={() => void command("archive.camera.start")}>Start camera recording</button>
      <button type="button" disabled={!allowed} onClick={() => void command("archive.camera.stop")}>Stop camera recording</button>
    </div>
    {confirmStart && <div role="alertdialog" aria-label="Confirm Facebook output"><p>{managed ? `Send PROGRAM to managed broadcast ${managed.id}: ${managed.title}? ${managed.status === "UNPUBLISHED" ? "This broadcast is non-public until you publish it." : "This broadcast may already be public."}` : "Send PROGRAM to Nick’s configured Facebook stream key? If Facebook auto-publish is enabled, this can become public immediately. Check destination and audio first."}</p><button type="button" onClick={() => void command("facebook.output.start", true)}>Confirm start Facebook output</button><button type="button" onClick={() => setConfirmStart(false)}>Cancel</button></div>}
    <label>Lower third<input maxLength={120} value={text} onChange={event => setText(event.target.value)} placeholder="On-screen text" /></label>
    <div className="producer-controls__grid"><button type="button" disabled={!canStart || !text.trim()} onClick={() => void command("lowerThird.set")}>Show lower third</button><button type="button" disabled={!canStart} onClick={() => void command("lowerThird.hide")}>Hide lower third</button></div>
    <p role="status" aria-live="polite">{message}</p>
    <p>Source: {status?.status?.source_state ?? "UNKNOWN"} · Facebook encoder: {status?.status?.broadcast?.state ?? "UNKNOWN"}</p>
    <p>Audio: {status?.status?.audio?.clipping ? "CLIPPING — reduce input level" : !status?.status?.audio?.available ? "UNAVAILABLE" : status.status.audio.silence ? "SILENT — check microphone" : "ACTIVE"}</p>
    <h3>Facebook broadcast</h3>
    <p>Destination: Storm Chaser Nick Mounce</p>
    {facebookError && <p className="workspace-warning">{facebookError}</p>}
    {!facebook?.permission && <p className="workspace-note">Public broadcast management requires reconnecting Facebook with Page publishing permission. Existing comments and encoder controls remain separate.</p>}
    {facebook?.permission && !facebook.enabled && <p className="workspace-note">Broadcast management is awaiting server qualification.</p>}
    {managed ? <><p><strong>{managed.title}</strong><br />Facebook status: {managed.status}<br />Broadcast {managed.id}</p><a href={managed.facebookProducerUrl} target="_blank" rel="noreferrer">Verify Facebook video and audio preview ↗</a><p className="workspace-note">{managedSynced ? "Encoder destination synchronized." : "Waiting for the broadcaster to synchronize this destination."}</p></> : <p>No managed Facebook broadcast prepared.</p>}
    {unresolved && <p role="alert">A {facebook?.operation?.action} operation is {facebook?.operation?.state}. Do not retry it. Verify the outcome in Facebook Live Producer.</p>}
    <label>Broadcast title<input maxLength={254} value={title} onChange={event => setTitle(event.target.value)} /></label>
    <label>Broadcast description<textarea maxLength={2000} rows={3} value={description} onChange={event => setDescription(event.target.value)} /></label>
    <div className="producer-controls__grid">
      <button type="button" disabled={!canStart || !facebook?.canManage || Boolean(managed && !managedTerminal) || unresolved || !title.trim()} onClick={() => setConfirmFacebook("prepare")}>Prepare non-public broadcast…</button>
      <button type="button" disabled={!canStart || !facebook?.canManage || managed?.status !== "UNPUBLISHED" || status?.status?.broadcast?.state !== "SENDING" || status.status.source_state !== "SOURCE_LIVE" || !audioHealthy || !managedSynced || unresolved} onClick={() => { setProgramConfirmed(false); setConfirmFacebook("publish") }}>Go Live on Facebook…</button>
      <button type="button" disabled={!allowed || busy || !facebook?.canManage || !managed || Boolean(managedTerminal) || managedEnding || unresolved} onClick={() => setConfirmFacebook("end")}>End Facebook broadcast…</button>
      <button type="button" disabled={!allowed || busy || !facebook?.canManage || !managed} onClick={() => void facebookAction("refresh")}>Check Facebook status</button>
    </div>
    {confirmFacebook && <div role="alertdialog" aria-label="Confirm Facebook broadcast action">
      <p>{confirmFacebook === "prepare" ? `Create a non-public broadcast on Storm Chaser Nick Mounce titled “${title.trim()}”?` : confirmFacebook === "publish" ? `Publish “${managed?.title}” publicly on Storm Chaser Nick Mounce now? This is a public broadcast.` : `End “${managed?.title}” on Storm Chaser Nick Mounce? Viewers will lose this live broadcast and the managed encoder will stop.`}</p>
      {confirmFacebook === "publish" && <label><input type="checkbox" checked={programConfirmed} onChange={event => setProgramConfirmed(event.target.checked)} />I verified the correct moving PROGRAM video and audible audio in Facebook’s preview.</label>}
      <button type="button" disabled={busy || (confirmFacebook === "publish" && !programConfirmed)} onClick={() => void facebookAction(confirmFacebook)}>Confirm {confirmFacebook === "publish" ? "public Go Live" : confirmFacebook}</button><button type="button" onClick={() => setConfirmFacebook(null)}>Cancel</button>
    </div>}
    <p className="workspace-note">Encoder SENDING does not prove the Facebook Page is public. Use Check Facebook status after publishing/ending. Changing a lower third currently reconnects the Facebook encoder briefly. 360 controls are not connected.</p>
  </section>
}
