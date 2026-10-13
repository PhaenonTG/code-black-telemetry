import { useCallback, useEffect, useRef, useState } from "react"
import { currentAccessToken } from "../core/client"

type Status = { bridge: string; controlAccess?: { allowed: boolean; userId: string }; controlLease?: { userId: string; operator: string; expiresAt: number } | null; status?: { stateRevision: number; source_state?: string; broadcast?: { state?: string }; audio?: { available?: boolean; silence?: boolean; clipping?: boolean } } }
type Command = { commandId: string; state: string; result?: { error?: string } }
async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const token = await currentAccessToken()
  if (!token) throw new Error("Sign in to OPS again.")
  const response = await fetch(`/api/producer/v1/${path}`, { method, cache: "no-store", headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
  return data as T
}

export default function ProducerControls() {
  const [status, setStatus] = useState<Status | null>(null)
  const [message, setMessage] = useState("")
  const [pending, setPending] = useState<Command | null>(null)
  const [confirmStart, setConfirmStart] = useState(false)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const renewing = useRef(false)
  const owner = Boolean(status?.controlLease && status.controlLease.expiresAt > Date.now() && status.controlLease.userId === status.controlAccess?.userId)
  const online = status?.bridge === "ONLINE"
  const allowed = status?.controlAccess?.allowed === true
  const refresh = useCallback(async () => { try { setStatus(await api<Status>("status")) } catch (error) { setStatus(null); setMessage(String(error instanceof Error ? error.message : error)) } }, [])
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 3_000); return () => window.clearInterval(timer) }, [refresh])
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
      const next = await api<Command>("commands", "POST", { commandId: crypto.randomUUID(), action, expectedStateRevision: latest.status!.stateRevision, confirmed, ...(action === "lowerThird.set" ? { payload: { text: text.trim() } } : {}) })
      setPending(next); setMessage("QUEUED — waiting for broadcaster acknowledgment.")
    } catch (error) { setMessage(error instanceof Error ? error.message : "Command delivery unknown; check status before retrying.") } finally { setBusy(false) }
  }
  const blocked = busy || pending?.state === "queued"
  const canStart = owner && online && !blocked
  return <section className="workspace-panel producer-controls" aria-label="PROGRAM controls">
    <header><h2>PROGRAM controls</h2><span className={online ? "workspace-live" : "workspace-muted"}>{online ? "ONLINE" : "OFFLINE"}</span></header>
    <p>{owner ? "You have control. Lease renews while this tab is visible." : status?.controlLease && status.controlLease.expiresAt > Date.now() ? `Controlled by ${status.controlLease.operator}` : "No operator holds control."}</p>
    <button type="button" disabled={!allowed || busy || (!owner && !online)} onClick={() => void lease(owner)}>{owner ? "Release control" : "Take control"}</button>
    {!allowed && <p className="workspace-note">Controls are restricted to approved producer accounts and must be enabled by the gateway.</p>}
    <div className="producer-controls__grid">
      <button type="button" disabled={!canStart} onClick={() => void command("preview.start")}>Arm / recover preview</button>
      <button type="button" disabled={!allowed || busy} onClick={() => void command("preview.stop")}>Stop preview + output</button>
      <button type="button" disabled={!canStart || status?.status?.source_state !== "SOURCE_LIVE"} onClick={() => setConfirmStart(true)}>Start Facebook output…</button>
      <button type="button" disabled={!allowed || busy} onClick={() => void command("facebook.output.stop")}>STOP Facebook output</button>
      <button type="button" disabled={!canStart} onClick={() => void command("archive.camera.start")}>Start camera recording</button>
      <button type="button" disabled={!allowed || busy} onClick={() => void command("archive.camera.stop")}>Stop camera recording</button>
    </div>
    {confirmStart && <div role="alertdialog" aria-label="Confirm Facebook output"><p>Send PROGRAM to Nick’s configured Facebook stream key? If Facebook auto-publish is enabled, this can become public immediately. Check destination and audio first.</p><button type="button" onClick={() => void command("facebook.output.start", true)}>Confirm start Facebook output</button><button type="button" onClick={() => setConfirmStart(false)}>Cancel</button></div>}
    <label>Lower third<input maxLength={120} value={text} onChange={event => setText(event.target.value)} placeholder="On-screen text" /></label>
    <div className="producer-controls__grid"><button type="button" disabled={!canStart || !text.trim()} onClick={() => void command("lowerThird.set")}>Show lower third</button><button type="button" disabled={!canStart} onClick={() => void command("lowerThird.hide")}>Hide lower third</button></div>
    <p role="status" aria-live="polite">{message}</p>
    <p>Source: {status?.status?.source_state ?? "UNKNOWN"} · Facebook encoder: {status?.status?.broadcast?.state ?? "UNKNOWN"}</p>
    <p className="workspace-note">Encoder SENDING does not prove the Facebook Page is public. Page publishing/ending and 360 camera controls are not yet qualified. Changing a lower third currently reconnects the Facebook encoder briefly.</p>
  </section>
}
