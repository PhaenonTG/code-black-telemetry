import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { approveChaseDay, fetchForecast } from "../core/client"
import { useCoreOps } from "../core/useCoreOps"
import { useAuth } from "../auth/AuthProvider"
import "./ChaseDay.css"

type SetupRow = { setup_id: string; publication_state: string; revision: number; valid_from: string; valid_until: string; generated_at: string; risk_label: string; day: number; model_status: string }
type SetupIndex = { status: string; checked_at?: string; last_source_check_at?: string; items: SetupRow[] }
type TargetPoint = { run_time?: string; valid_time?: string; score_index?: number; classification?: string }
type SetupDetail = {
  setup_id: string; publication_state: string; revision: number; generated_at: string; first_seen_at?: string; valid_from: string; valid_until: string; summary?: string
  identity_review_required?: boolean
  official: { provider?: string; day?: number; risk_label?: string; issued_at?: string; source_url?: string }
  model: { status?: string; source?: string; target_points?: TargetPoint[]; notice?: string }
  source_checks?: { hrrr?: { status?: string; hours_checked?: number; hours_missing?: number } }
  review?: { required?: boolean; decision?: string | null; reason?: string }
}

const setupId = /^setup-\d{8}-[0-9a-f]{10}$/
function stamp(value?: string) { const parsed = value ? new Date(value) : null; return parsed && Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : "Unavailable" }
function short(value?: string) { const parsed = value ? new Date(value) : null; return parsed && Number.isFinite(parsed.getTime()) ? parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—" }
function confidence(point?: TargetPoint) { const score = point?.score_index; if (typeof score !== "number") return "Not calculated"; if (score >= 0.7) return "Higher"; if (score >= 0.4) return "Moderate"; return "Limited" }

export default function ChaseDay() {
  const { config } = useCoreOps(); const { setupId: routeId } = useParams(); const navigate = useNavigate(); const auth = useAuth()
  const [index, setIndex] = useState<SetupIndex | null>(null); const [detail, setDetail] = useState<SetupDetail | null>(null)
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false)
  const refresh = useCallback(async (signal?: AbortSignal) => { setBusy(true); setError(""); try { setIndex(await fetchForecast<SetupIndex>(config, "chase-setups", signal)) } catch { if (!signal?.aborted) setError("Chase-day source data is unavailable. No briefing has been inferred.") } finally { if (!signal?.aborted) setBusy(false) } }, [config])
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort() }, [refresh])
  const selectedId = useMemo(() => routeId && setupId.test(routeId) ? routeId : index?.items[0]?.setup_id, [routeId, index])
  useEffect(() => { const controller = new AbortController(); setDetail(null); if (!selectedId) return () => controller.abort(); void fetchForecast<SetupDetail>(config, `chase-setup?setup_id=${encodeURIComponent(selectedId)}`, controller.signal).then((next) => { if (!controller.signal.aborted) setDetail(next) }).catch(() => { if (!controller.signal.aborted) setError("This private chase-day draft is unavailable.") }); return () => controller.abort() }, [config, selectedId])
  const points = detail?.model.target_points ?? []; const lead = points[0]
  const reviewed = detail?.publication_state === "approved"
  const canApprove = auth.status === "authorized" && (auth.profile.role === "OWNER" || auth.profile.role === "ADMIN") && !reviewed && !detail?.identity_review_required
  const [approvalBusy, setApprovalBusy] = useState(false)
  const approve = async () => { if (!detail || !canApprove) return; setApprovalBusy(true); setError(""); try { await approveChaseDay(config, detail.setup_id, detail.revision); setDetail({ ...detail, publication_state: "approved" }); await refresh() } catch { setError("Approval could not be completed. Refresh the draft and verify your OPS role.") } finally { setApprovalBusy(false) } }
  return <main className="chase-day page">
    <header className="chase-day__header"><div><p className="chase-day__crumb">ANALYSIS / CHASE DAY</p><h1>Chase day{detail?.official.day ? ` · SPC Day ${detail.official.day}` : ""}</h1><p>Live private operational briefing. Official guidance remains the authority.</p></div><div className="chase-day__actions"><span className={index?.status === "ready" ? "is-current" : "is-stale"}>{index?.status === "ready" ? "Sources current" : "Source check pending"}</span><button onClick={() => void refresh()} disabled={busy}>{busy ? "Checking…" : "Refresh"}</button></div></header>
    {error && <p className="chase-day__error" role="alert">{error}</p>}
    {!detail ? <section className="chase-day__empty"><strong>{index?.items.length ? "Loading chase-day briefing…" : "No active chase-day draft"}</strong><p>{index?.items.length ? "Retrieving the revision-bound source packet." : "Qualifying SPC setups will appear here after a complete source check."}</p></section> : <div className="chase-day__layout">
      <section className="chase-day__brief"><div className="chase-day__headline"><div><span>PRIVATE {reviewed ? "APPROVED" : "DRAFT"}</span><h2>{detail.official.risk_label ?? "Operational briefing"}</h2><p>{detail.summary || "A source-grounded briefing has not been generated for this revision."}</p></div><dl><div><dt>Revision</dt><dd>{detail.revision}</dd></div><div><dt>Updated</dt><dd>{short(detail.generated_at)}</dd></div></dl></div>
        <div className="chase-day__signals"><div><small>Confidence</small><strong>{confidence(lead)}</strong><p>Based on current official guidance and experimental screening; not a probability.</p></div><div><small>Primary target</small><strong>{lead?.classification ?? "Awaiting model screening"}</strong><p>{lead ? `Forecast-valid ${short(lead.valid_time)}` : "No retained in-area candidate."}</p></div><div><small>Timing window</small><strong>{short(detail.valid_from)}–{short(detail.valid_until)}</strong><p>SPC valid period for this private draft.</p></div></div>
        <section className="chase-day__section"><h3>Target comparison</h3>{points.length ? <table><thead><tr><th>Candidate</th><th>Forecast valid</th><th>Screening state</th><th>Confidence</th></tr></thead><tbody>{points.slice(0, 6).map((point, i) => <tr key={`${point.run_time}-${point.valid_time}-${i}`}><td>{point.classification ?? `Candidate ${i + 1}`}</td><td>{stamp(point.valid_time)}</td><td>{detail.model.status === "available" ? "Available" : "Unavailable"}</td><td>{confidence(point)}</td></tr>)}</tbody></table> : <p className="chase-day__muted">No current target candidates are retained.</p>}</section>
        <section className="chase-day__section"><h3>Evidence timeline</h3><ol className="chase-day__timeline"><li><time>{short(detail.official.issued_at)}</time><div><b>SPC outlook</b><p>{detail.official.provider ?? "Official source"} · {detail.official.risk_label ?? "classification unavailable"}</p></div></li><li><time>{short(lead?.run_time)}</time><div><b>HRRR screening</b><p>{detail.model.status === "available" ? `${points.length} retained candidate${points.length === 1 ? "" : "s"}` : "Screening unavailable"}</p></div></li><li><time>{short(detail.generated_at)}</time><div><b>Draft revision</b><p>Revision {detail.revision} compiled from the current source packet.</p></div></li></ol></section>
        <section className="chase-day__ai"><div><h3>AI review</h3><p>{reviewed ? "Approved schedule is being evaluated by the private worker." : "Approval is required before the private hourly Sol review can run."}</p></div><span>{reviewed ? "APPROVED" : "AWAITING OWNER APPROVAL"}</span></section>
        <footer className="chase-day__revision"><span>Revision {detail.revision}</span><span>Generated {stamp(detail.generated_at)}</span>{detail.official.source_url && <a href={detail.official.source_url} target="_blank" rel="noreferrer">Official SPC source ↗</a>}</footer>
      </section>
      <aside className="chase-day__rail"><section><h3>Drafts</h3><ul>{(index?.items ?? []).map((row) => <li key={row.setup_id}><button className={row.setup_id === selectedId ? "active" : ""} onClick={() => navigate(`/chase-day/${row.setup_id}`)}><b>SPC Day {row.day} · {row.risk_label}</b><span>Revision {row.revision} · {row.model_status === "available" ? "screened" : "screening unavailable"}</span></button></li>)}</ul><Link to="/chase-setups">Open draft desk →</Link></section><section><h3>Data status</h3><dl><div><dt>Official outlook</dt><dd>{detail.official.issued_at ? "Available" : "Pending"}</dd></div><div><dt>HRRR screening</dt><dd>{detail.model.status === "available" ? "Available" : "Unavailable"}</dd></div><div><dt>Last source check</dt><dd>{short(index?.last_source_check_at ?? index?.checked_at)}</dd></div></dl></section><section className="chase-day__approval"><button type="button" disabled={!canApprove || approvalBusy} onClick={() => void approve()}>{approvalBusy ? "Approving…" : reviewed ? "Publication approved" : "Approve publication"}</button><p>{reviewed ? "The approved revision is eligible for private hourly Sol review." : canApprove ? "Approves this exact private revision; it does not make it public." : "Only an active OPS owner or admin may approve an exact revision."}</p></section></aside>
    </div>}
  </main>
}
