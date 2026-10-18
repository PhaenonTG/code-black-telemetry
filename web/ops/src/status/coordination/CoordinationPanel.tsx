import { useCallback, useEffect, useRef, useState } from "react"
import { currentAccessToken, buildCoreRequestHeaders } from "../../core/client"
import { LABELS, PROJECTS, validateCoordination, type CoordinationView } from "./contract"
import "./coordination.css"

async function loadSnapshot(signal: AbortSignal): Promise<CoordinationView> {
  if (signal.aborted) throw Error("Coordination request cancelled")
  let cancel = () => {}
  const cancelled = new Promise<never>((_, reject) => {
    cancel = () => reject(Error("Coordination request cancelled"))
    signal.addEventListener("abort", cancel, { once: true })
  })
  let token: string | null
  try { token = await Promise.race([currentAccessToken(), cancelled]) }
  finally { signal.removeEventListener("abort", cancel) }
  const result = await fetch("/api/coordination/v1/snapshot", { signal, cache: "no-store", headers: buildCoreRequestHeaders(token) })
  if (!result.ok) throw new Error("Coordination evidence is unavailable. A private session and approved snapshot are required.")
  return validateCoordination(await result.json())
}
function time(value: string) { return new Date(value).toISOString().replace("T", " ").replace(".000Z", " UTC") }

/** Loader is injectable for isolated fixture QA; production always uses the authenticated endpoint. */
export default function CoordinationPanel({ load = loadSnapshot }: { load?: (signal: AbortSignal) => Promise<CoordinationView> }) {
  const [snapshot, setSnapshot] = useState<CoordinationView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [project, setProject] = useState("all")
  const pending = useRef<AbortController | null>(null)
  const refresh = useCallback(async () => {
    if (pending.current) return
    const controller = new AbortController(); pending.current = controller; setBusy(true)
    const timeout = window.setTimeout(() => controller.abort(), 10_000)
    try {
      const next = validateCoordination(await load(controller.signal))
      if (pending.current === controller) { setSnapshot(next); setError(null) }
    } catch {
      if (pending.current === controller) setError("Coordination evidence is unavailable. Last received evidence, if shown, is stale and requires reconciliation.")
    } finally {
      window.clearTimeout(timeout)
      if (pending.current === controller) { pending.current = null; setBusy(false) }
    }
  }, [load])
  useEffect(() => { void refresh(); return () => { const active = pending.current; pending.current = null; active?.abort() } }, [refresh])
  const sessions = snapshot?.sessions.filter(s => project === "all" || s.project_id === project) ?? []
  const queue = snapshot?.queue.filter(q => project === "all" || q.project_id === project) ?? []
  return <section className="coordination" aria-label="Session coordination">
    <header className="coordination__header">
      <div><span className="coordination__eyebrow">CODE BLACK / EXECUTION EVIDENCE</span><h2>SESSION COORDINATION</h2>
        <p>Read-only handoffs alongside the project tracker. The 31-item audit remains authoritative.</p></div>
      <button type="button" onClick={() => { void refresh() }} disabled={busy}>{busy ? "Refreshing…" : "Refresh evidence"}</button>
    </header>
    <p className="coordination__notice" role="status">{error ? "STALE / UNAVAILABLE" : snapshot ? `FRESHNESS ${snapshot.stale_state.state}` : "EVIDENCE UNAVAILABLE"} · Session activity does not establish deployment or health.</p>
    {error && <p role="alert" className="coordination__error">{error}</p>}
    {snapshot ? <>
      <dl className="coordination__times"><div><dt>Source observed</dt><dd>{time(snapshot.source_observed_at_utc)}</dd></div><div><dt>Snapshot exported</dt><dd>{time(snapshot.generated_at_utc)}</dd></div></dl>
      <p className="coordination__muted">{LABELS[snapshot.stale_state.reason]}</p>
      <label className="coordination__filter">Project <select value={project} onChange={e => setProject(e.target.value)}><option value="all">All approved projects</option>{Object.entries(PROJECTS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <p className="coordination__muted">{sessions.length} session record(s). Ownership shown below is evidence to reconcile, not an exclusive assignment.</p>
      <div className="coordination__sessions">{sessions.map(s => <article key={s.session_id}>
        <header><h3>{PROJECTS[s.project_id]}</h3><span className="coordination__tag">{s.review_state.replaceAll("_", " ")}</span></header>
        <p>{LABELS[s.scope]}</p><p className="coordination__muted">{s.owner_role.replaceAll("_", " ")} · {s.evidence_class} · {time(s.observed_at_utc)}</p>
        <details><summary>Ownership and handoff evidence</summary>
          <dl><dt>Session</dt><dd className="coordination__id">{s.session_id}</dd><dt>Audit references</dt><dd>{s.audit_ids.join(", ") || "No audit item assigned"}</dd><dt>Owned scope labels</dt><dd>{s.owned_labels.map(c => LABELS[c]).join("; ") || "Unverified"}</dd><dt>Source base commit (changes may be uncommitted)</dt><dd className="coordination__id">{s.commit ?? "Unverified"}</dd><dt>Evidence IDs</dt><dd>{s.evidence_ids.join(", ")}</dd></dl>
          <h4>Changes</h4>{s.changes.length ? <ul>{s.changes.map(c => <li key={c}>{LABELS[c]}</li>)}</ul> : <p>No curated changes reported.</p>}
          <h4>Tests</h4>{s.tests.length ? <ul>{s.tests.map((t, i) => <li key={i}>{LABELS[t.label]} · {t.result} · {t.evidence_class} · {time(t.observed_at_utc)}</li>)}</ul> : <p>No test evidence supplied.</p>}
          <p><strong>Deployment: {s.deployment}</strong> · {LABELS[s.rollback]}</p>
          <h4>Blockers</h4><ul>{s.blockers.map(c => <li key={c}>{LABELS[c]}</li>)}</ul>
          <h4>Next actions</h4><ul>{s.next_actions.map(c => <li key={c}>{LABELS[c]}</li>)}</ul>
        </details>
      </article>)}</div>
      <div className="coordination__queue"><h3>REVIEW / HANDOFF QUEUE</h3><p>Only the coordinator assigns turns after reviewing a saved handoff. Age and silence never release ownership or promote a request.</p>
        {queue.length ? <ul>{queue.map(q => <li key={q.request_id}><strong>{q.state.replaceAll("_", " ")}</strong> · {PROJECTS[q.project_id]}<br /><span className="coordination__id">{q.session_id}</span><br /><small>{q.evidence_class} · {time(q.observed_at_utc)} · {q.request_id}{q.decision_id ? ` · Decision ${q.decision_id}` : " · No coordinator decision"}</small></li>)}</ul> : <p>No curated queue requests in this snapshot. This does not prove the canonical queue is empty.</p>}
      </div>
      <footer className="coordination__muted">Snapshot <span className="coordination__id">{snapshot.source_snapshot_id.slice(0, 16)}</span> · Derived view; canonical log remains the source.</footer>
    </> : <p className="coordination__muted">No approved snapshot received. Queue, ownership, tests and deployment are unknown.</p>}
  </section>
}
