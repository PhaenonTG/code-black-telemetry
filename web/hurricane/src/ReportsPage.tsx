import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { displayTime } from "./types";
import { fetchStormReports, timeAgo } from "./reports";
import type { StormReport } from "./reports";
import codeblackShield from "../../../src/assets/codeblack-shield.png";

const ReportsMap = lazy(() => import("./ReportsMap"));
const tokenUrl = import.meta.env.DEV ? "/api/mapbox-token" : "https://ops.codeblackwx.com/overlay-core/mapbox-token";
type Feed = Awaited<ReturnType<typeof fetchStormReports>>;

function ReportRow({ row, index, selected, now, onSelect }: { row: StormReport; index: number; selected: boolean; now: number; onSelect: () => void }) {
  return <button className={`report-row${selected ? " report-row--selected" : ""}`} type="button" onClick={onSelect} aria-pressed={selected}>
    <span className="report-row__number">{String(index + 1).padStart(2, "0")}</span>
    <span className="report-row__time"><b>{timeAgo(row.occurredAt, now)}</b><small>{displayTime(row.occurredAt)}</small></span>
    <strong className="report-row__event">{row.event}</strong>
    <span className="report-row__location"><b>{row.location}</b><small>{row.county ? `${row.county} County` : ""}{row.state ? `, ${row.state}` : ""}</small></span>
    <span className="report-row__source">{row.source}<small>NWS {row.office}</small></span>
    <span className="report-row__details">{row.details || "No additional remarks in the NWS product."}</span>
  </button>;
}

export default function ReportsPage() {
  useEffect(() => { document.title = "Storm Reports | Code Black Tropics"; }, []);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [hours, setHours] = useState<24 | 72 | 168>(72);
  const [office, setOffice] = useState("ALL");
  const [event, setEvent] = useState("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(15);
  useEffect(() => { setVisibleCount(15); }, [hours, office, event]);
  const load = useCallback(async (signal: AbortSignal) => {
    try { const next = await fetchStormReports(signal); if (!signal.aborted) { setFeed(next); setError(null); } }
    catch { if (!signal.aborted) setError("NWS report products could not be checked. Use the official NWS link below."); }
  }, []);
  useEffect(() => {
    const controller = new AbortController(); void load(controller.signal);
    const interval = window.setInterval(() => void load(controller.signal), 300_000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [load]);
  useEffect(() => { const interval = window.setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(interval); }, []);
  useEffect(() => { let alive = true; fetch(tokenUrl).then((response) => response.json()).then((body) => { if (alive && typeof body.token === "string") setToken(body.token); }).catch(() => {}); return () => { alive = false; }; }, []);
  const events = useMemo(() => [...new Set((feed?.reports ?? []).map((row) => row.event))].sort(), [feed]);
  const reports = useMemo(() => (feed?.reports ?? []).filter((row) => Date.parse(row.occurredAt) >= now - hours * 3_600_000 && (office === "ALL" || row.office === office) && (event === "ALL" || row.event === event)), [feed, now, hours, office, event]);
  const mapped = reports.filter((row) => row.latitude != null && row.longitude != null);
  const selected = reports.find((row) => row.id === selectedId) ?? reports[0] ?? null;
  const refresh = () => { const controller = new AbortController(); void load(controller.signal); };
  return <div className="site-shell reports-page"><header className="site-header"><a href="/" className="brand" aria-label="Tropics home"><img className="brand-shield" src={codeblackShield} alt=""/><span>CODE BLACK <em>TROPICS</em></span></a><nav aria-label="Primary"><a href="/">Dashboard</a><a href="/#track">Track</a><a href="/reports" aria-current="page">Reports</a></nav><a className="official-link" href="https://www.weather.gov/" target="_blank" rel="noreferrer">NWS official ↗</a></header>
    <main><div className="reports-head"><div><h1>Storm reports</h1><p>Preliminary National Weather Service local storm reports · Gulf region</p></div><div className="reports-updated"><span>Last checked</span><strong>{feed ? displayTime(feed.checkedAt) : "Checking…"}</strong><button type="button" onClick={refresh}>Refresh ↻</button></div></div>
      {(error || (feed?.failedOffices.length ?? 0) > 0) && <div className="status-warning" role="status">{error ?? `Partial NWS feed: ${feed!.failedOffices.join(", ")} unavailable. Missing reports are possible.`}</div>}
      <div className="reports-layout"><div className="reports-feed"><div className="reports-toolbar"><label>Office<select value={office} onChange={(e) => { setOffice(e.target.value); setSelectedId(null); }}><option value="ALL">All Gulf offices</option>{["MOB", "LIX", "TAE", "JAN"].map((item) => <option key={item} value={item}>NWS {item}</option>)}</select></label><label>Event<select value={event} onChange={(e) => { setEvent(e.target.value); setSelectedId(null); }}><option value="ALL">All events</option>{events.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>Time range<select value={hours} onChange={(e) => { setHours(Number(e.target.value) as 24 | 72 | 168); setSelectedId(null); }}><option value={24}>Past 24 hours</option><option value={72}>Past 72 hours</option><option value={168}>Past 7 days</option></select></label></div>
          <div className="reports-count"><span>{reports.length} report{reports.length === 1 ? "" : "s"} · {mapped.length} mapped</span><span>{feed ? `Event time · source checked ${timeAgo(feed.checkedAt, now)}` : "Checking NWS products…"}</span></div>
          {!feed && !error ? <div className="reports-empty">Checking NWS report products…</div> : reports.length === 0 ? <div className="reports-empty"><strong>No reports in this view</strong><p>{error ? "The source is unavailable, not an all-clear." : `No NWS LSR entries matched the selected offices, events, and past ${hours === 168 ? "7 days" : `${hours} hours`}. Try a longer time range or the official NWS source.`}</p></div> : <><div className="reports-table-head" aria-hidden="true"><span>#</span><span>Time</span><span>Event</span><span>Location</span><span>Source</span><span>Details</span></div><div className="report-list" aria-label="NWS storm reports">{reports.slice(0, visibleCount).map((row, index) => <ReportRow key={row.id} row={row} index={index} selected={selected?.id === row.id} now={now} onSelect={() => setSelectedId(row.id)}/>)}</div>{visibleCount < reports.length && <button className="reports-more" type="button" onClick={() => setVisibleCount((count) => count + 15)}>Show more reports · {reports.length - visibleCount} remaining ↓</button>}</>}
        </div><aside className="reports-side"><div className="reports-map-head"><h2>Report locations</h2><span>{mapped.length} mapped</span></div><Suspense fallback={<div className="reports-map-loading">Loading report map…</div>}><ReportsMap token={token} reports={reports} selectedId={selectedId} onSelect={setSelectedId}/></Suspense>{selected ? <div className="report-detail"><div className="report-detail__head"><span>SELECTED REPORT</span><h2>{selected.event}</h2></div><dl><div><dt>Occurred</dt><dd>{displayTime(selected.occurredAt)} · {timeAgo(selected.occurredAt, now)}</dd></div><div><dt>Location</dt><dd>{selected.location}{selected.county ? ` · ${selected.county} County` : ""}{selected.state ? `, ${selected.state}` : ""}</dd></div><div><dt>Source</dt><dd>{selected.source} · NWS {selected.office}</dd></div>{selected.magnitude && <div><dt>Magnitude</dt><dd>{selected.magnitude}</dd></div>}</dl><p>{selected.details || "No further details in the NWS product."}</p>{selected.latitude != null && selected.longitude != null && <small>Approximate reported point: {selected.latitude.toFixed(2)}°, {selected.longitude.toFixed(2)}°</small>}<a href={selected.productUrl} target="_blank" rel="noreferrer">View original NWS product ↗</a></div> : <div className="report-detail report-detail--empty">Select a report to inspect its source and location.</div>}</aside></div>
      <p className="reports-disclaimer">NWS Local Storm Reports are preliminary and may be corrected. Reports shown here are regional; they are not automatically attributable to this hurricane. Pins reflect coordinates in the NWS product and may be approximate. For protective decisions, use official NWS warnings.</p>
    </main></div>;
}
