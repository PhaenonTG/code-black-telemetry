import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { currentAccessToken } from "../core/client"
import { readProducerResponse } from "./producerResponse"
import { producerReadAllowed, producerRetryMessage } from "./producerRateLimit"
import { useProducerRead } from "./useProducerRead"
import { pollProducerCommand } from "./producerPolling"
import ConfirmDialog from "../components/ConfirmDialog"
import ObsOutputControls from "./ObsOutputControls"
import type { ObsOutputStatus } from "./obsOutputPolicy"

type Status = { bridge: string; controlAccess?: { allowed: boolean; userId: string }; controlLease?: { userId: string; operator: string; expiresAt: number } | null; status?: ObsOutputStatus & { stateRevision: number; source_state?: string; broadcast?: { state?: string; managedVideoId?: string | null }; archive?: { camera?: { state?: string; recording?: boolean } }; lowerThird?: { active?: boolean; text?: string }; audio?: { available?: boolean; state?: string; silence?: boolean; clipping?: boolean } } }
type Lifecycle = { enabled: boolean; permission: boolean; canManage: boolean; broadcast: { id: string; title: string; description: string; status: string; facebookProducerUrl: string } | null; operation?: { state: string; action: string } | null }
type Command = { commandId: string; state: string; result?: { error?: string } }
async function api<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal, beforeSend?: () => void): Promise<T> {
  if (method === "GET" && !producerReadAllowed()) throw new Error(producerRetryMessage())
  const token = await currentAccessToken()
  signal?.throwIfAborted()
  if (!token) throw new Error("Sign in to OPS again.")
  beforeSend?.()
  const response = await fetch(`/api/producer/v1/${path}`, { method, cache: "no-store", headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: signal ?? AbortSignal.timeout(10_000) })
  signal?.throwIfAborted()
  return readProducerResponse<T>(response)
}

export default function ProducerControls() {
  const [status, setStatus] = useState<Status | null>(null)
  const [message, setMessage] = useState("")
  const [pending, setPending] = useState<Command | null>(null)
  const [confirmStart, setConfirmStart] = useState<string | null>(null)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [facebook, setFacebook] = useState<Lifecycle | null>(null)
  const [facebookError, setFacebookError] = useState("")
  const [title, setTitle] = useState("Storm Chaser Nick Mounce — Live")
  const [description, setDescription] = useState("")
  const [confirmFacebook, setConfirmFacebook] = useState<{ action: "prepare" | "publish" | "end"; identity: string } | null>(null)
  const [programConfirmed, setProgramConfirmed] = useState(false)
  const [checkedAt, setCheckedAt] = useState(() => Date.now())
  const renewing = useRef(false)
  const owner = Boolean(status?.controlLease && status.controlLease.expiresAt > checkedAt && status.controlLease.userId === status.controlAccess?.userId)
  const online = status?.bridge === "ONLINE"
  const allowed = status?.controlAccess?.allowed === true
  // Snapshot every identity shown by the confirmation, including the encoder destination.
  const encoderIdentity = JSON.stringify([status?.status?.engine, status?.status?.composition?.id, status?.status?.broadcast?.managedVideoId, status?.status?.outputs?.facebook?.destination])
  const facebookIdentity = JSON.stringify([encoderIdentity, facebook?.broadcast?.id, facebook?.broadcast?.title, facebook?.broadcast?.status, title.trim(), description, owner, allowed, online])
  const currentFacebookIdentity = useRef(facebookIdentity)
  useLayoutEffect(() => { currentFacebookIdentity.current = facebookIdentity }, [facebookIdentity])
  // Discard the snapshot, so switching away and back cannot resurrect an approval.
  if (confirmStart !== null && confirmStart !== facebookIdentity) setConfirmStart(null)
  if (confirmFacebook && confirmFacebook.identity !== facebookIdentity) { setConfirmFacebook(null); setProgramConfirmed(false) }
  const statusRead = useProducerRead()
  const facebookRead = useProducerRead()
  const leaseRead = useProducerRead()
  const actionRead = useProducerRead()
  const refresh = useCallback(() => statusRead.run(signal => api<Status>("status", "GET", undefined, signal), next => { setStatus(next); setCheckedAt(Date.now()) }, error => { setStatus(null); setMessage(error instanceof Error ? error.message : String(error)) }), [statusRead])
  useEffect(() => { const initial = window.setTimeout(() => void refresh(), 0); const timer = window.setInterval(() => { if (!document.hidden && producerReadAllowed()) void refresh() }, 30_000); return () => { statusRead.cancel(); window.clearTimeout(initial); window.clearInterval(timer) } }, [refresh, statusRead])
  const refreshFacebook = useCallback(() => facebookRead.run(signal => api<Lifecycle>("facebook", "GET", undefined, signal), next => { setFacebook(next); setFacebookError("") }, error => setFacebookError(error instanceof Error ? error.message : "Facebook management unavailable")), [facebookRead])
  useEffect(() => { const initial = window.setTimeout(() => void refreshFacebook(), 0); const timer = window.setInterval(() => { if (!document.hidden && producerReadAllowed()) void refreshFacebook() }, 60_000); return () => { facebookRead.cancel(); window.clearTimeout(initial); window.clearInterval(timer) } }, [refreshFacebook, facebookRead])
  useEffect(() => {
    if (!owner) return
    const timer = window.setInterval(async () => {
      if (renewing.current || document.visibilityState !== "visible") return
      renewing.current = true
      try { await leaseRead.run(signal => api("control-lease", "POST", undefined, signal), () => { void refresh() }, () => setMessage("Control lease lost. Take control again before sending commands.")) } finally { renewing.current = false }
    }, 10_000)
    return () => { leaseRead.cancel(); window.clearInterval(timer) }
  }, [owner, refresh, leaseRead])
  useEffect(() => {
    if (!pending || pending.state !== "queued") return
    const started = Date.now()
    return pollProducerCommand(
      signal => api<Command>(`commands/${pending.commandId}`, "GET", undefined, signal),
      next => next.state !== "queued" || Date.now() - started > 20_000,
      next => {
        if (next.state !== "queued") { setPending(next); setMessage(`${next.state.toUpperCase()}${next.result?.error ? `: ${next.result.error}` : " — check live status below."}`); void refresh() }
        else if (Date.now() - started > 20_000) { setPending({ ...next, state: "unknown" }); setMessage("Delivery unconfirmed. Check output status before trying another start command.") }
      },
      reason => {
        if (Date.now() - started > 20_000) { setPending({ ...pending, state: "unknown" }); setMessage("Delivery unconfirmed. Connection lost; check status before retrying."); return true }
        setMessage(reason instanceof Error ? reason.message : "Command status unavailable; delivery unconfirmed.")
        return false
      },
    )
  }, [pending, refresh])
  async function lease(release = false) {
    setBusy(true)
    await actionRead.run(signal => api("control-lease", release ? "DELETE" : "POST", undefined, signal), () => {
      setMessage(release ? "Control released." : "You have control."); setBusy(false); void refresh()
    }, error => { setMessage(error instanceof Error ? error.message : "Control unavailable"); setBusy(false) })
  }
  async function command(action: string, confirmed = false, expectedComposition?: string, expectedFacebookIdentity?: string) {
    setBusy(true); setConfirmStart(null)
    await actionRead.run(async signal => {
      const latest = await api<Status>("status", "GET", undefined, signal)
      signal.throwIfAborted()
      if (!Number.isSafeInteger(latest.status?.stateRevision)) throw new Error("No current broadcaster revision.")
      if (action === "facebook.output.start" && (expectedFacebookIdentity !== currentFacebookIdentity.current || encoderIdentity !== JSON.stringify([latest.status?.engine, latest.status?.composition?.id, latest.status?.broadcast?.managedVideoId, latest.status?.outputs?.facebook?.destination]))) throw new Error("Facebook destination or PROGRAM changed after confirmation. Review and confirm again.")
      const output = /^obs\.output\.(facebook|youtube)\.(start|stop)$/.exec(action)
      if (output) {
        const compositionId = latest.status?.composition?.id
        if (!/^[a-f0-9]{24}$/.test(compositionId ?? "")) throw new Error("No current PROGRAM composition.")
        if (output[2] === "start" && expectedComposition !== compositionId) throw new Error("PROGRAM changed after confirmation. Review the preview and confirm again.")
        const next = await api<Command>("commands", "POST", { commandId: crypto.randomUUID(), action, expectedStateRevision: latest.status!.stateRevision, confirmed, payload: { destination: output[1], compositionId, confirmed } }, signal)
        return { latest, next, obs: true }
      }
      const next = await api<Command>("commands", "POST", { commandId: crypto.randomUUID(), action, expectedStateRevision: latest.status!.stateRevision, confirmed, ...(action === "lowerThird.set" ? { payload: { text: text.trim() } } : action === "facebook.output.start" && facebook?.broadcast ? { payload: { videoId: facebook.broadcast.id } } : {}) }, signal, () => {
        if (action === "facebook.output.start" && expectedFacebookIdentity !== currentFacebookIdentity.current) throw new Error("Facebook destination or PROGRAM changed after confirmation. Review and confirm again.")
      })
      return { latest, next, obs: false }
    }, ({ latest, next, obs }) => {
      setStatus(latest); setPending(next); setMessage(obs ? "QUEUED — waiting for OBS output acknowledgment." : "QUEUED — waiting for broadcaster acknowledgment."); setBusy(false)
    }, error => { setMessage(error instanceof Error ? error.message : "Command delivery unknown; check status before retrying."); setBusy(false) })
  }
  async function facebookAction(action: "prepare" | "publish" | "end" | "refresh", expectedIdentity?: string) {
    if (action !== "refresh" && expectedIdentity !== currentFacebookIdentity.current) return
    setBusy(true); setConfirmFacebook(null)
    const finish = () => { setBusy(false); setProgramConfirmed(false); void refreshFacebook(); void refresh() }
    await actionRead.run(signal => api(`facebook/${action}`, "POST", { requestId: crypto.randomUUID(), confirmed: true, videoId: facebook?.broadcast?.id, title: title.trim(), description, programConfirmed }, signal, () => {
      if (action !== "refresh" && expectedIdentity !== currentFacebookIdentity.current) throw new Error("Facebook broadcast changed after confirmation. Review and confirm again.")
    }), () => {
      setMessage(action === "prepare" ? "Non-public broadcast prepared. Wait for the encoder destination to synchronize, then send PROGRAM to Facebook preview." : action === "refresh" ? "Facebook status checked." : `${action.toUpperCase()} acknowledged by Meta. Check Facebook status to confirm the final state.`)
      finish()
    }, error => {
      setMessage(error instanceof Error && !["TypeError", "TimeoutError", "AbortError"].includes(error.name) ? error.message : "Meta delivery unconfirmed. Do not retry; check Facebook directly before taking another action.")
      finish()
    })
  }
  const blocked = busy || pending?.state === "queued"
  const canStart = owner && online && !blocked
  const managed = facebook?.broadcast
  const managedTerminal = managed && ["LIVE_STOPPED", "PROCESSING", "VOD", "ENDED", "SCHEDULED_CANCELED"].includes(managed.status)
  const managedEnding = managed?.status === "END_REQUESTED"
  const managedSynced = !managed || status?.status?.broadcast?.managedVideoId === managed.id
  const unresolved = facebook?.operation?.state === "pending" || facebook?.operation?.state === "unknown"
  const audioHealthy = status?.status?.audio?.available === true && !status.status.audio.silence && !status.status.audio.clipping
  const facebookSending = /sending|live|active/i.test(status?.status?.broadcast?.state ?? "")
  const cameraRecording = status?.status?.archive?.camera?.recording === true || /recording|active/i.test(status?.status?.archive?.camera?.state ?? "")
  const lowerThirdActive = status?.status?.lowerThird?.active === true || Boolean(status?.status?.lowerThird?.text)
  return <section className="workspace-panel producer-controls" aria-label="PROGRAM controls">
    <header><h2>PROGRAM controls</h2><span className={online ? "workspace-live" : "workspace-muted"}>{online ? "ONLINE" : "OFFLINE"}</span></header>
    <p>{owner ? "You have control. Lease renews while this tab is visible." : status?.controlLease && status.controlLease.expiresAt > checkedAt ? `Controlled by ${status.controlLease.operator}` : "No operator holds control."}</p>
    <button type="button" disabled={!allowed || busy || (!owner && !online)} onClick={() => void lease(owner)}>{owner ? "Release control" : "Take control"}</button>
    {!allowed && <p className="workspace-note">Controls are restricted to approved producer accounts and must be enabled by the gateway.</p>}
    {status?.status?.engine === "obs" && <ObsOutputControls status={status.status} owner={owner} allowed={allowed} online={online} busy={blocked} onCommand={command} />}
    <div className="producer-controls__grid">
      <button type="button" disabled={!canStart} onClick={() => void command("preview.start")}>Arm / recover preview</button>
      <button type="button" disabled={!allowed} onClick={() => void command("preview.stop")}>{status?.status?.engine === "obs" ? "Stop private monitor" : "Stop preview + output"}</button>
      {status?.status?.engine !== "obs" && <><button type="button" disabled={!canStart || status?.status?.source_state !== "SOURCE_LIVE" || !audioHealthy || !managedSynced || Boolean(managedTerminal) || managedEnding || unresolved} onClick={() => setConfirmStart(facebookIdentity)}>{managed ? "Send to Facebook preview…" : "Start Facebook output…"}</button>
      <button type="button" disabled={!owner || !online || blocked || !facebookSending} onClick={() => void command("facebook.output.stop")}>STOP Facebook output</button></>}
      <button type="button" disabled={!canStart || cameraRecording} onClick={() => void command("archive.camera.start")}>Start camera recording</button>
      <button type="button" disabled={!owner || !online || blocked || !cameraRecording} onClick={() => void command("archive.camera.stop")}>Stop camera recording</button>
    </div>
    {confirmStart === facebookIdentity && <ConfirmDialog title="Confirm Facebook output" onCancel={() => setConfirmStart(null)} consequence={managed ? `Send PROGRAM to managed broadcast ${managed.id}: ${managed.title}? ${managed.status === "UNPUBLISHED" ? "This broadcast is non-public until you publish it." : "This broadcast may already be public."}` : "Send PROGRAM to Nick’s configured Facebook stream key? If Facebook auto-publish is enabled, this can become public immediately. Check destination and audio first."}><button type="button" onClick={() => void command("facebook.output.start", true, undefined, confirmStart)}>Confirm start Facebook output</button></ConfirmDialog>}
    <label>Lower third<input maxLength={120} value={text} onChange={event => setText(event.target.value)} placeholder="On-screen text" /></label>
    <div className="producer-controls__grid"><button type="button" disabled={!canStart || !text.trim()} onClick={() => void command("lowerThird.set")}>Show lower third</button><button type="button" disabled={!canStart || !lowerThirdActive} onClick={() => void command("lowerThird.hide")}>Hide lower third</button></div>
    <p role="status" aria-live="polite">{message}</p>
    <p>Source: {status?.status?.source_state ?? "UNKNOWN"} · Facebook encoder: {status?.status?.broadcast?.state ?? "UNKNOWN"}</p>
    <p>Audio: {status?.status?.audio?.clipping ? "CLIPPING — reduce input level" : !status?.status?.audio?.available ? "UNAVAILABLE" : status.status.audio.silence ? "SILENT — check microphone" : "ACTIVE"}</p>
    {status?.status?.engine === "obs" ? <p className="workspace-note">Encoder SENDING does not prove a platform is public. Verify on <a href="https://www.facebook.com/live/producer" target="_blank" rel="noreferrer">Facebook Live Producer</a> and <a href="https://studio.youtube.com/channel/UCafIaG7PZnEI3b5PsKiblfw/livestreaming" target="_blank" rel="noreferrer">Code Black WX YouTube Studio</a>. Stopping output is separate from ending a platform broadcast.</p> : <>
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
      <button type="button" disabled={!canStart || !facebook?.canManage || Boolean(managed && !managedTerminal) || unresolved || !title.trim()} onClick={() => setConfirmFacebook({ action: "prepare", identity: facebookIdentity })}>Prepare non-public broadcast…</button>
      <button type="button" disabled={!canStart || !facebook?.canManage || managed?.status !== "UNPUBLISHED" || status?.status?.broadcast?.state !== "SENDING" || status.status.source_state !== "SOURCE_LIVE" || !audioHealthy || !managedSynced || unresolved} onClick={() => { setProgramConfirmed(false); setConfirmFacebook({ action: "publish", identity: facebookIdentity }) }}>Go Live on Facebook…</button>
      <button type="button" disabled={!allowed || busy || !facebook?.canManage || !managed || Boolean(managedTerminal) || managedEnding || unresolved} onClick={() => setConfirmFacebook({ action: "end", identity: facebookIdentity })}>End Facebook broadcast…</button>
      <button type="button" disabled={!allowed || busy || !facebook?.canManage || !managed} onClick={() => void facebookAction("refresh")}>Check Facebook status</button>
    </div>
    {confirmFacebook?.identity === facebookIdentity && <ConfirmDialog title="Confirm Facebook broadcast action" onCancel={() => setConfirmFacebook(null)}
      consequence={confirmFacebook.action === "prepare" ? `Create a non-public broadcast on Storm Chaser Nick Mounce titled “${title.trim()}”?` : confirmFacebook.action === "publish" ? `Publish “${managed?.title}” publicly on Storm Chaser Nick Mounce now? This is a public broadcast.` : `End “${managed?.title}” on Storm Chaser Nick Mounce? Viewers will lose this live broadcast and the managed encoder will stop.`}>
      {confirmFacebook.action === "publish" && <label><input type="checkbox" checked={programConfirmed} onChange={event => setProgramConfirmed(event.target.checked)} />I verified the correct moving PROGRAM video and audible audio in Facebook’s preview.</label>}
      <button type="button" disabled={busy || (confirmFacebook.action === "publish" && !programConfirmed)} onClick={() => void facebookAction(confirmFacebook.action, confirmFacebook.identity)}>Confirm {confirmFacebook.action === "publish" ? "public Go Live" : confirmFacebook.action}</button>
    </ConfirmDialog>}
    <p className="workspace-note">Encoder SENDING does not prove the Facebook Page is public. Use Check Facebook status after publishing/ending. Changing a lower third currently reconnects the Facebook encoder briefly. 360 controls are not connected.</p>
    </>}
  </section>
}
