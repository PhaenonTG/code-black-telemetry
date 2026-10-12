import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { loadOpsIncidents, type OpsIncident, verifyOpsIncident } from "../diagnostics";
import { useCoreOps } from "../core/useCoreOps";

function stamp(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }

export default function Diagnostics() {
  const { config } = useCoreOps();
  const [events, setEvents] = useState<OpsIncident[]>([]); const [severity, setSeverity] = useState<"" | OpsIncident["severity"]>("");
  const [selected, setSelected] = useState<OpsIncident | null>(null); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  const refresh = async () => { setLoading(true); setError(null); try { const next = await loadOpsIncidents(config, severity || undefined); setEvents(next); setSelected((current) => next.find((item) => item.id === current?.id) ?? next[0] ?? null); } catch { setError("Diagnostics is unavailable. Core did not confirm the incident ledger."); } finally { setLoading(false); } };
  useEffect(() => { void refresh(); }, [config, severity]);
  const counts = useMemo(() => ({ errors: events.filter((event) => event.severity === "ERROR").length, warnings: events.filter((event) => event.severity === "WARN").length, verified: events.filter((event) => event.verified_at).length }), [events]);
  const markVerified = async () => { if (!selected) return; await verifyOpsIncident(config, selected.id); await refresh(); };
  return <div className="page page-diagnostics">
    <PageHeader kicker="OPS" title="DIAGNOSTICS" description="Correlated, redacted incident records from the OPS browser, gateway, and Core. Request bodies, credentials, and precise coordinates are never retained." actions={<button className="page-action-link" onClick={() => void refresh()} disabled={loading}>{loading ? "REFRESHING…" : "REFRESH"}</button>} />
    <section className="diagnostics-summary"><div><span>ERRORS</span><b>{counts.errors}</b></div><div><span>WARNINGS</span><b>{counts.warnings}</b></div><div><span>VERIFIED</span><b>{counts.verified}</b></div><div><span>RETENTION</span><b>500 EVENTS</b></div></section>
    <div className="diagnostics-filter"><label>SEVERITY <select value={severity} onChange={(event) => setSeverity(event.target.value as typeof severity)}><option value="">ALL</option><option value="ERROR">ERROR</option><option value="WARN">WARN</option><option value="INFO">INFO</option></select></label><span>Each record carries one trace ID across OPS and Core.</span></div>
    {error && <p className="diagnostics-error" role="alert">{error}</p>}
    <section className="diagnostics-layout"><div className="diagnostics-table-wrap"><table className="diagnostics-table"><thead><tr><th>TIME</th><th>SEV</th><th>SOURCE</th><th>ACTION</th><th>TRACE</th><th>RESULT</th></tr></thead><tbody>{events.map((event) => <tr key={event.id} className={selected?.id === event.id ? "is-selected" : ""} onClick={() => setSelected(event)}><td>{stamp(event.created_at)}</td><td data-severity={event.severity}>{event.severity}</td><td>{event.source}</td><td>{event.action}</td><td>{event.trace_id}</td><td>{event.result}</td></tr>)}{!loading && !events.length && <tr><td colSpan={6}>NO INCIDENTS MATCH THIS FILTER.</td></tr>}</tbody></table></div>
      <aside className="diagnostics-detail">{selected ? <><header><span>INCIDENT DETAIL</span><b data-severity={selected.severity}>{selected.severity}</b></header><h2>{selected.action.replaceAll("_", " ")}</h2><dl><div><dt>TRACE ID</dt><dd>{selected.trace_id}</dd></div><div><dt>SOURCE</dt><dd>{selected.source}</dd></div><div><dt>SUBSYSTEM</dt><dd>{selected.subsystem}</dd></div><div><dt>RESULT</dt><dd>{selected.result}</dd></div><div><dt>TIME</dt><dd>{stamp(selected.created_at)}</dd></div></dl><p>{selected.message || "No additional safe diagnostic message was retained."}</p><p className="diagnostics-privacy">No request body, credentials, or precise location is stored in this incident.</p><button className="page-action-link" onClick={() => void markVerified()} disabled={Boolean(selected.verified_at)}>{selected.verified_at ? "VERIFIED" : "MARK VERIFIED"}</button></> : <p>Select an incident to inspect its correlated record.</p>}</aside></section>
  </div>
}
