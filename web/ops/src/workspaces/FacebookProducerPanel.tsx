import { useEffect, useRef, useState } from "react"
import { currentAccessToken } from "../core/client"
import { createProducerPoll } from "./producerPolling"
import { noteProducerResponse, producerReadAllowed, producerRetryMessage } from "./producerRateLimit"

type Comment = { id: string; author: string; message: string; createdAt: string }
type Connection = { state: string; page?: { label?: string }; canConnect?: boolean; canReply?: boolean }
type Draft = { comment: Comment; message: string; requestId: string; confirming: boolean; attempted: boolean }

async function request(path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
  if (body === undefined && !producerReadAllowed()) throw new Error(producerRetryMessage())
  const token = await currentAccessToken()
  signal?.throwIfAborted()
  if (!token) throw new Error("Sign in to OPS first.")
  const response = await fetch(`/api/chase/v1/${path}`, {
    method: body === undefined ? "GET" : "POST", cache: "no-store", signal: signal ?? AbortSignal.timeout(body === undefined ? 12_000 : 25_000),
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  noteProducerResponse(response)
  return response
}

export default function FacebookProducerPanel() {
  const [comments, setComments] = useState<Comment[]>([])
  const [feedState, setFeedState] = useState("Connecting")
  const [connection, setConnection] = useState<Connection | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const cursor = useRef("")
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    let cancelled = false; let timer = 0
    const commentsRead = createProducerPoll()
    const connectionRead = createProducerPoll()
    const poll = async () => {
      let delay = 30_000
      if (document.hidden || !producerReadAllowed()) { if (!cancelled) timer = window.setTimeout(() => void poll(), delay); return }
      await commentsRead.run(async signal => {
        const response = await request(`comments?after=${encodeURIComponent(cursor.current)}`, undefined, signal)
        if (!response.ok) throw new Error(response.status === 401 ? "Sign-in required" : response.status === 429 ? producerRetryMessage() : "Unavailable")
        return await response.json() as { state?: string; cursor?: string; comments?: Comment[]; pollAfterMs?: number; page?: { live?: boolean } }
      }, next => {
        setFeedState(next.state === "ok" ? next.page?.live ? "Live" : "No active Facebook Live" : next.state || "Unavailable")
        if (typeof next.cursor === "string") cursor.current = next.cursor
        setComments(prior => {
          const unique = new Map(prior.map(item => [item.id, item]))
          for (const item of next.comments || []) if (typeof item.id === "string") unique.set(item.id, item)
          return [...unique.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).slice(-100)
        })
        delay = Math.max(15_000, Math.min(60_000, Number(next.pollAfterMs) || 30_000))
      }, error => { setFeedState(error instanceof Error ? error.message : "Unavailable"); delay = 30_000 }, 12_000)
      if (!cancelled) timer = window.setTimeout(() => void poll(), delay)
    }
    const status = async () => {
      if (document.hidden || !producerReadAllowed()) return
      await connectionRead.run(async signal => {
        const response = await request("facebook/status", undefined, signal)
        if (!response.ok) throw new Error()
        return await response.json() as Connection
      }, setConnection, () => setConnection(null), 12_000)
    }
    void poll(); void status()
    const statusTimer = window.setInterval(() => void status(), 60_000)
    const focus = () => void status()
    window.addEventListener("focus", focus)
    return () => { cancelled = true; commentsRead.dispose(); connectionRead.dispose(); mounted.current = false; window.clearTimeout(timer); window.clearInterval(statusTimer); window.removeEventListener("focus", focus) }
  }, [])

  const connect = async () => {
    setBusy(true); setMessage("")
    try {
      const response = await request("facebook/connect-session", {})
      if (!response.ok) throw new Error("Facebook connection is unavailable for this OPS account.")
      const next = await response.json() as { connectUrl?: string }
      if (!next.connectUrl || !/^https:\/\/ops\.codeblackwx\.com\/api\/chase\/v1\/facebook\/connect\?ticket=[A-Za-z0-9_-]{43}$/.test(next.connectUrl)) throw new Error("Connection link was rejected.")
      window.location.assign(next.connectUrl)
    } catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : "Connection failed.") }
    finally { if (mounted.current) setBusy(false) }
  }

  const send = async () => {
    if (!draft || busy || draft.attempted) return
    const current = draft
    setBusy(true); setMessage(""); setDraft({ ...current, attempted: true })
    try {
      const response = await request("facebook/reply", { commentId: current.comment.id, message: current.message, requestId: current.requestId, confirmed: true })
      const result = await response.json() as { state?: string; error?: string }
      if (response.ok && result.state === "sent") {
        if (mounted.current) { setDraft(null); setMessage("Reply sent as the Page.") }
      } else if (mounted.current) {
        if (result.state === "unknown" || result.error === "REPLY_ALREADY_ATTEMPTED") setMessage("Delivery is uncertain. Check Facebook before composing another reply; this request will not be sent again.")
        else { setDraft({ ...current, attempted: false, confirming: false }); setMessage(`Reply not sent: ${result.error || "Facebook unavailable"}.`) }
      }
    } catch { if (mounted.current) setMessage("Delivery is uncertain. Check Facebook before composing another reply; this request will not be sent again.") }
    finally { if (mounted.current) setBusy(false) }
  }

  return <section className="workspace-panel producer-facebook" aria-label="Facebook comments and replies">
    <header><h2>Facebook comments</h2><span>{feedState}</span></header>
    <p>{connection?.page?.label || "Storm Chaser Nick Mounce"} · {connection?.state || "Connection status unavailable"}</p>
    {connection?.canConnect && <button type="button" disabled={busy} onClick={() => void connect()}>{connection.state === "connected" ? "Reconnect Facebook" : "Connect Facebook"}</button>}
    {message && <p role="status">{message}</p>}
    <div className="producer-facebook__comments">{comments.length ? comments.slice(-30).map(comment => <article key={comment.id}>
      <strong>{comment.author || "Viewer"}</strong><time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleTimeString()}</time>
      <p>{comment.message}</p>
      {connection?.canReply && feedState === "Live" && <button type="button" disabled={busy} onClick={() => { setDraft({ comment, message: "", requestId: crypto.randomUUID(), confirming: false, attempted: false }); setMessage("") }}>Reply to {comment.author || "viewer"}</button>}
    </article>) : <p>No comments received yet.</p>}</div>
    {draft && <div className="producer-facebook__reply" role="group" aria-label="Compose Facebook reply">
      <strong>Reply to {draft.comment.author}</strong><blockquote>{draft.comment.message}</blockquote>
      <label htmlFor="facebook-reply">Reply as {connection?.page?.label || "the Page"}</label>
      <textarea id="facebook-reply" maxLength={2000} value={draft.message} disabled={busy || draft.confirming || draft.attempted} onChange={event => setDraft({ ...draft, message: event.target.value, requestId: crypto.randomUUID() })} />
      {draft.confirming ? <><p>This reply will be public and posted as {connection?.page?.label || "the Page"}.</p><button type="button" disabled={busy || draft.attempted || !connection?.canReply || feedState !== "Live"} onClick={() => void send()}>{busy ? "Sending…" : "Confirm and send reply"}</button></> : <button type="button" disabled={busy || draft.attempted || !draft.message.trim()} onClick={() => setDraft({ ...draft, confirming: true })}>Review reply</button>}
      <button type="button" disabled={busy} onClick={() => setDraft(null)}>Cancel reply</button>
    </div>}
    <p className="workspace-note">{connection?.canReply ? "Approved producers can reply publicly as this Page." : "Replies become available after Facebook grants comment-management access to an approved producer."}</p>
  </section>
}
