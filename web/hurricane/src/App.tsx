import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import ModelGuidance from "./ModelGuidance";
import LiveCameras from "./LiveCameras";
import { saveBriefingImage } from "./briefingPoster";
import type { PublicHurricane } from "./types";
import { displayTime, signed } from "./types";
import { DEFAULT_WATCH, fetchPointAlerts, watchSummary } from "./watchLocation";
import type { PointAlert, WatchLocation } from "./watchLocation";
import codeblackShield from "../../../src/assets/codeblack-shield.png";
import { hurricaneCategory } from "../../shared/hurricaneCategory";
import { compassDirection, currentAdvisoryTrend, estimateNorthernGulfLandfall, reviewedLandfall } from "./stormTelemetry";

const HurricaneMap = lazy(() => import("./HurricaneMap"));

const dataUrl = import.meta.env.DEV ? "/api/hurricane" : "https://ops.codeblackwx.com/api/public/hurricane";
const tokenUrl = import.meta.env.DEV ? "/api/mapbox-token" : "https://ops.codeblackwx.com/overlay-core/mapbox-token";
const ageMinutes = (value: string | null | undefined, now: number) => value ? Math.round((now - Date.parse(value)) / 60000) : Infinity;
const alertPriority = (event: string) => /tornado warning/i.test(event) ? 0 : /hurricane warning/i.test(event) ? 1 : /storm surge warning/i.test(event) ? 2 : /tropical storm warning/i.test(event) ? 3 : /flood warning/i.test(event) ? 4 : /warning/i.test(event) ? 5 : /watch/i.test(event) ? 6 : 7;
const alertTiming = (alert: PointAlert, now: number) => {
  if (alert.onset && alert.ends && Date.parse(alert.onset) > now) return `Begins ${displayTime(alert.onset)} · through ${displayTime(alert.ends)}`;
  if (alert.ends) return `Through ${displayTime(alert.ends)}`;
  if (alert.onset && Date.parse(alert.onset) > now) return `Begins ${displayTime(alert.onset)}`;
  return "Ongoing — check the latest NWS product";
};

function AegisBriefing({ data, watch }: { data: PublicHurricane; watch: WatchLocation }) {
  const ai = data.ai;
  const reviewed = ai?.status === "ready" || ai?.status === "stale";
  const changedWatch = watch.latitude !== DEFAULT_WATCH.latitude || watch.longitude !== DEFAULT_WATCH.longitude;
  const changes = data.changes;
  const changeItems = [
    changes?.advisory_changed ? "New NHC advisory" : null,
    changes?.model_cycle_changes?.length ? `${changes.model_cycle_changes.length} model cycle${changes.model_cycle_changes.length === 1 ? "" : "s"} updated` : null,
    changes?.new_alerts?.length ? `${changes.new_alerts.length} new NWS alert${changes.new_alerts.length === 1 ? "" : "s"}` : null,
    changes?.new_report_count ? `${changes.new_report_count} new report product${changes.new_report_count === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return <section className="aegis-briefing" id="aegis" aria-label="Aegis analysis">
    <div className="aegis-briefing__head"><h2>{reviewed ? "Aegis briefing" : "Storm briefing"}</h2><span className={`aegis-briefing__state${ai?.status === "ready" ? "" : " aegis-briefing__state--missing"}`}>{ai?.status === "ready" ? `${ai.review_model === "gpt-6.1-sol" ? "API" : "30B"} reviewed · experimental` : ai?.status === "stale" ? `Earlier ${ai.review_model === "gpt-6.1-sol" ? "API" : "30B"} review` : "Aegis text unavailable"}</span></div>
    {changeItems.length > 0 && <div className="aegis-delta"><span>Changed since last check</span><strong>{changeItems.join(" · ")}</strong></div>}
    {reviewed && ai?.summary ? <><p className="aegis-briefing__summary">{ai.summary}</p>
      <div className="aegis-briefing__details"><div><h3>Signals in view</h3><ul>{ai.supporting_factors.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul></div>
        <div><h3>Uncertainty</h3><ul>{ai.uncertainties.slice(0, 2).map((item) => <li key={item}>{item}</li>)}</ul></div></div>
      <p className="aegis-briefing__meta">Reviewed {displayTime(ai.reviewed_at)} · Sources {displayTime(data.checked_at)}</p></> : <p className="aegis-briefing__summary aegis-briefing__summary--fallback">NHC: {data.storm.max_wind_mph == null ? "wind unavailable" : `${data.storm.max_wind_mph} mph maximum sustained wind`}{data.storm.movement_mph == null ? "" : `; moving ${data.storm.movement_mph} mph`}. Aegis briefing unavailable; use the official advisory.</p>}
    <div className="aegis-facts"><div><span>48h model spread</span><strong>{data.guidance.spread_48h_miles == null ? "Unavailable" : `${Math.round(data.guidance.spread_48h_miles)} mi`}</strong></div><div><span>Track guidance</span><strong>{data.guidance.models.length} models</strong></div><div><span>Gulf radar</span><strong>{data.monitoring.radar_analysis === "ready" ? "MRMS LIVE" : data.monitoring.radar_analysis === "partial" ? "PARTIAL" : "UNAVAILABLE"}</strong>{data.monitoring.radar_observed_at && <small>{displayTime(data.monitoring.radar_observed_at)}</small>}</div></div>
    {changedWatch && <p className="aegis-briefing__scope">Briefing anchored to Grand Bay; selected-location distances and alerts update separately.</p>}
    {reviewed && <p className="aegis-briefing__caution">Experimental · <a href={data.official.discussion_url ?? "https://www.nhc.noaa.gov/"} target="_blank" rel="noreferrer">NHC discussion ↗</a></p>}
  </section>;
}

function TrendChart({ data }: { data: PublicHurricane }) {
  const points = data.observed.track.filter((point) => point.wind_mph != null && point.valid_time).sort((a, b) => Date.parse(a.valid_time!) - Date.parse(b.valid_time!));
  if (points.length < 2) return <p className="empty">Observed wind history is not available.</p>;
  const winds = points.map((point) => point.wind_mph!);
  const lo = Math.floor(Math.min(...winds) / 10) * 10 - 10, hi = Math.ceil(Math.max(...winds) / 10) * 10 + 10;
  const coordinates = points.map((point, index) => `${48 + index * 660 / (points.length - 1)},${218 - (point.wind_mph! - lo) / (hi - lo) * 168}`).join(" ");
  return <div className="trend-wrap"><svg viewBox="0 0 760 260" role="img" aria-label="Observed maximum sustained wind trend from NHC preliminary best track">
    {[0, 1, 2, 3].map((line) => <g key={line}><line x1="48" x2="708" y1={50 + line * 56} y2={50 + line * 56} stroke="#2b4351" strokeWidth="1"/>
      <text x="5" y={56 + line * 56} fill="#9aafb9" fontSize="15">{Math.round(hi - line * (hi - lo) / 3)}</text></g>)}
    <polyline points={coordinates} fill="none" stroke="#45d9d1" strokeWidth="4" strokeLinejoin="round"/>
    {points.map((point, index) => <circle key={point.valid_time} cx={48 + index * 660 / (points.length - 1)} cy={218 - (point.wind_mph! - lo) / (hi - lo) * 168} r="4" fill="#45d9d1"/>)}
    <text x="48" y="252" fill="#9aafb9" fontSize="15">{displayTime(points[0].valid_time)}</text><text x="708" y="252" fill="#9aafb9" fontSize="15" textAnchor="end">{displayTime(points.at(-1)?.valid_time)}</text>
  </svg><p>Preliminary observed NHC best track. It is not a forecast.</p></div>;
}

function TrendPill({ delta, unit, elapsedHours, dangerWhen, label }: { delta: number | null; unit: string; elapsedHours: number | null; dangerWhen: "up" | "down"; label: string }) {
  if (delta == null || elapsedHours == null) return <small className="metric-trend metric-trend--unknown">Prior center data unavailable</small>;
  const state = delta === 0 ? "steady" : (delta > 0) === (dangerWhen === "up") ? "adverse" : "improving";
  const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
  return <small className={`metric-trend metric-trend--${state}`} aria-label={`${label} ${delta > 0 ? "up" : delta < 0 ? "down" : "unchanged"} ${Math.abs(delta)} ${unit} since the previous NHC position ${elapsedHours} hours ago`}>
    <span aria-hidden="true">{arrow}</span> {signed(delta, unit)} <span className="metric-trend__period">/ {elapsedHours}h</span>
  </small>;
}

const gulfTime = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", timeZoneName: "short" }).format(new Date(value));

function LandfallCard({ data, now, stale }: { data: PublicHurricane; now: number; stale: boolean }) {
  const aegis = estimateNorthernGulfLandfall(data, "aegis");
  const nhc = estimateNorthernGulfLandfall(data, "nhc");
  const reviewed = reviewedLandfall(data);
  const primary = reviewed ?? aegis ?? nhc;
  if (!primary) return null;
  const selectedNhc = Boolean(reviewed && data.ai?.landfall?.source === "NHC");
  const comparison = selectedNhc ? aegis : nhc;
  const differenceHours = comparison ? Math.round((Date.parse(primary.centerTime) - Date.parse(comparison.centerTime)) / 3_600_000) : null;
  const minutesLeft = Math.ceil((Date.parse(primary.centerTime) - now) / 60_000);
  const countdown = stale ? "SOURCE CHECK STALE" : minutesLeft > 0
    ? `${Math.floor(minutesLeft / 1440)}d ${Math.floor(minutesLeft % 1440 / 60)}h ${minutesLeft % 60}m`
    : minutesLeft > -360 ? "CROSSING WINDOW" : "ESTIMATE PASSED";
  return <section className="landfall-card" aria-label="Estimated Gulf Coast crossing">
    <div className="landfall-card__title"><span>ESTIMATED CENTER COAST CROSSING</span><strong>{reviewed ? "AEGIS REVIEWED · EXPERIMENTAL" : aegis ? "CODE BLACK EXPERIMENTAL" : "NHC CENTERLINE"}</strong></div>
    <div className="landfall-card__grid"><div><span>Estimated time · Central</span><strong>~{gulfTime(primary.centerTime)}</strong><small>Window {gulfTime(primary.windowStart)} – {gulfTime(primary.windowEnd)}</small></div><div><span>Coastal location</span><strong>{primary.nearestCity ? `Near ${primary.nearestCity}` : primary.region}</strong><small>{primary.region}{reviewed ? ` · selected ${data.ai?.landfall?.source} guidance` : aegis ? ` · ${primary.members} model tracks` : ""}</small></div><div className="landfall-card__countdown"><span>Time to estimated crossing</span><strong>{countdown}</strong>{stale && <small>Check NHC for current guidance</small>}</div>
    {(reviewed || aegis) && comparison && <div className="landfall-card__comparison"><span>{selectedNhc ? "Model-blend comparison" : "NHC centerline comparison"}</span><strong>~{gulfTime(comparison.centerTime)}</strong><small>{comparison.region} · {selectedNhc ? `model cycle ${data.projection.cycle ? gulfTime(data.projection.cycle) : "unavailable"}` : `forecast issued ${data.official.issued_at ? gulfTime(data.official.issued_at) : "unavailable"}`}</small></div>}</div>
    {reviewed ? <div className="landfall-card__source-line">Aegis reviewed {displayTime(data.ai?.reviewed_at)} · {data.ai?.landfall?.source} centerline selected from current guidance</div>
      : aegis && data.projection.cycle && data.official.issued_at && <div className="landfall-card__source-line">Model cycle {gulfTime(data.projection.cycle)} · NHC forecast {gulfTime(data.official.issued_at)}{data.projection.cycle_lag_hours != null && data.projection.cycle_lag_hours > 0 ? ` · model cycle ${data.projection.cycle_lag_hours}h earlier` : ""}</div>}
    {differenceHours != null && Math.abs(differenceHours) >= 6 && <div className="landfall-card__divergence" role="status">Tracks differ by ~{Math.abs(differenceHours)}h in center-crossing time. The model blend is experimental; check the newer NHC advisory and local warnings.</div>}
    <p>Experimental center estimate, not an official landfall or local-impact forecast. Hazards can arrive before the center. <a href={data.official.discussion_url ?? "https://www.nhc.noaa.gov/"} target="_blank" rel="noreferrer">NHC discussion ↗</a></p>
  </section>;
}

function App() {
  const [data, setData] = useState<PublicHurricane | null>(null), [token, setToken] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(true), [exporting, setExporting] = useState(false);
  const [copyState, setCopyState] = useState<"copied" | "failed" | null>(null);
  const [capture, setCapture] = useState<(() => Promise<string | null>) | null>(null);
  const [watch, setWatch] = useState<WatchLocation>(DEFAULT_WATCH);
  const [editingWatch, setEditingWatch] = useState(false), [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false), [searchError, setSearchError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<WatchLocation[]>([]);
  const [pointAlerts, setPointAlerts] = useState<PointAlert[]>([]), [alertsStatus, setAlertsStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [alertsCheckedAt, setAlertsCheckedAt] = useState<string | null>(null);
  const registerCapture = useCallback((value: (() => Promise<string | null>) | null) => setCapture(() => value), []);
  const refresh = useCallback(async () => {
    try { const response = await fetch(dataUrl, { cache: "no-store" }); if (!response.ok) throw new Error(`Feed returned ${response.status}`);
      const next = await response.json() as PublicHurricane; setData((current) => current && JSON.stringify(current) === JSON.stringify(next) ? current : next); setError(null);
    } catch { setError("The latest hurricane analysis could not be loaded. Please use the official NHC forecast linked below."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); const interval = window.setInterval(() => void refresh(), 60_000); return () => clearInterval(interval); }, [refresh]);
  useEffect(() => { const interval = window.setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(interval); }, []);
  useEffect(() => { let alive = true; fetch(tokenUrl).then((response) => response.json()).then((body) => { if (alive && typeof body.token === "string") setToken(body.token); }).catch(() => {}); return () => { alive = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setAlertsStatus("loading"); setPointAlerts([]); setAlertsCheckedAt(null);
    const checkAlerts = () => fetchPointAlerts(watch, controller.signal).then((alerts) => {
      if (!controller.signal.aborted) { setPointAlerts(alerts); setAlertsStatus("ready"); setAlertsCheckedAt(new Date().toISOString()); }
    }).catch(() => { if (!controller.signal.aborted) { setAlertsStatus("unavailable"); setAlertsCheckedAt(new Date().toISOString()); } });
    void checkAlerts();
    const interval = window.setInterval(() => void checkAlerts(), 60_000);
    return () => { window.clearInterval(interval); controller.abort(); };
  }, [watch]);
  const searchAddress = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setCandidates([]); setSearchError(null);
    if (!token) { setSearchError("Address search is loading. Please try again shortly."); return; }
    if (query.trim().length < 5) { setSearchError("Enter a street address, city, or ZIP code."); return; }
    setSearching(true);
    try {
      const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
      url.searchParams.set("q", query.trim().slice(0, 256)); url.searchParams.set("access_token", token);
      url.searchParams.set("country", "us"); url.searchParams.set("limit", "5"); url.searchParams.set("autocomplete", "false");
      const response = await fetch(url); if (!response.ok) throw new Error("Geocoding failed");
      const body = await response.json() as { features?: { properties?: { full_address?: string; name?: string; place_formatted?: string }; geometry?: { coordinates?: number[] } }[] };
      const results = (body.features ?? []).map((feature) => ({
        label: feature.properties?.full_address ?? [feature.properties?.name, feature.properties?.place_formatted].filter(Boolean).join(", "),
        longitude: feature.geometry?.coordinates?.[0] ?? NaN, latitude: feature.geometry?.coordinates?.[1] ?? NaN,
      })).filter((result) => result.label && Number.isFinite(result.latitude) && Number.isFinite(result.longitude));
      setCandidates(results); if (!results.length) setSearchError("No matching US location found. Try a fuller address.");
    } catch { setSearchError("Address search is unavailable. The current watch location has not changed."); }
    finally { setSearching(false); }
  };
  const selectWatch = (candidate: WatchLocation) => { setWatch(candidate); setEditingWatch(false); setCandidates([]); setQuery(""); setSearchError(null); };
  const stale = useMemo(() => data ? ageMinutes(data.checked_at, now) > 90 || (data.status === "active" && ageMinutes(data.guidance.latest_cycle, now) > 900) : false, [data, now]);
  const proximity = useMemo(() => data ? watchSummary(data, watch) : null, [data, watch]);
  const category = data ? hurricaneCategory(data.storm.max_wind_mph, data.storm.classification) : null;
  const currentTrend = data ? currentAdvisoryTrend(data, watch) : null;
  const movementDirection = data ? compassDirection(data.storm.movement_degrees) : null;
  const exportImage = async () => { if (!data) return; setExporting(true); try { await saveBriefingImage(data, await capture?.() ?? null, watch, [...pointAlerts].sort((a, b) => alertPriority(a.event) - alertPriority(b.event)), alertsStatus); } catch { setError("The image could not be created on this device. Try print / PDF instead."); } finally { setExporting(false); } };
  const copyLink = async () => { try { await navigator.clipboard.writeText("https://tropics.codeblackwx.com/"); setCopyState("copied"); } catch { setCopyState("failed"); } window.setTimeout(() => setCopyState(null), 3000); };
  return <div className="site-shell"><header className="site-header"><a href="/" className="brand" aria-label="Tropics home"><img className="brand-shield" src={codeblackShield} alt=""/><span>CODE BLACK <em>TROPICS</em></span></a>
    <nav aria-label="Primary"><a href="#track">Track</a><a href="#aegis">Aegis</a><a href="#watch">Local watch</a><a href="#models">Models</a><a href="/reports">Reports</a><a href="#cameras">Cameras</a></nav><a className="official-link" href="https://www.nhc.noaa.gov/" target="_blank" rel="noreferrer">NHC official ↗</a></header>
    <main>{loading && !data ? <div className="loading">Loading Tropics…</div> : !data ? <div className="failure"><h1>Tropics unavailable</h1><p>{error}</p><a href="https://www.nhc.noaa.gov/">View the official NHC forecast ↗</a></div> : <>
      <section className="storm-head"><div><h1>{data.storm.classification === "HU" ? "Hurricane" : "Storm"} {data.storm.name ?? "watch"}</h1>{category !== null && <span className="storm-category">{data.status === "active" ? "NHC CATEGORY" : "LAST NHC CATEGORY"} <b>{category}</b></span>}</div><div className="update-info">{(stale || data.status !== "active") && <strong>{data.status === "post_storm_watch" && !stale ? "POST-STORM WATCH" : "LATEST AVAILABLE"}</strong>}<span>NHC {displayTime(data.storm.last_update)}</span><span>Sources {displayTime(data.checked_at)}</span><button onClick={() => void refresh()} type="button">Refresh data ↻</button></div></section>
      {(error || stale || data.status !== "active") && <div className="status-warning" role="alert">{error ?? (stale ? "The latest source check is old. Consult NHC and NWS directly before making decisions." : data.status === "post_storm_watch" ? "NHC no longer lists this cyclone as active. Its track is historical; the NWS alert and report watch continues." : "This storm is no longer listed as active. The map shows its last published track.")}</div>}
      <div className="metrics" aria-label="Latest NHC storm measurements"><div><span>Maximum sustained wind</span><strong>{data.storm.max_wind_mph == null ? "—" : `${data.storm.max_wind_mph} mph`}</strong><TrendPill delta={currentTrend?.wind ?? null} unit="mph" elapsedHours={currentTrend?.elapsedHours ?? null} dangerWhen="up" label="Maximum sustained wind"/></div><div><span>Minimum pressure</span><strong>{data.storm.pressure_mb == null ? "—" : `${data.storm.pressure_mb} mb`}</strong><TrendPill delta={currentTrend?.pressure ?? null} unit="mb" elapsedHours={currentTrend?.elapsedHours ?? null} dangerWhen="down" label="Minimum pressure"/></div><div><span>Movement</span><div className="metric-movement">{data.storm.movement_degrees == null ? null : <span className="metric-compass" aria-label={`Moving ${movementDirection ?? "unknown direction"}`}><span>N</span><svg viewBox="0 0 40 40" aria-hidden="true" style={{ transform: `rotate(${data.storm.movement_degrees}deg)` }}><path d="M20 5 26 26 20 22 14 26Z"/></svg></span>}<strong>{movementDirection ?? "—"}{data.storm.movement_mph == null ? "" : ` · ${data.storm.movement_mph} mph`}</strong></div><small className="metric-detail">{data.storm.movement_degrees == null ? "Direction unavailable" : `${data.storm.movement_degrees}° from north`}</small></div><div><span>Center to {watch.label}</span><strong>{proximity?.currentMiles == null ? "—" : `${proximity.currentMiles} mi`}</strong><TrendPill delta={currentTrend?.distance ?? null} unit="mi" elapsedHours={currentTrend?.elapsedHours ?? null} dangerWhen="down" label={`Center distance to ${watch.label}`}/></div></div>
      <LandfallCard data={data} now={now} stale={stale}/>
      <section className="projection-grid" id="track"><div className="dashboard-intel"><AegisBriefing data={data} watch={watch}/><div className={`snapshot-watch ${pointAlerts.some((alert) => /warning/i.test(alert.event)) ? "snapshot-watch--warning" : ""}`}><div><span>WATCH LOCATION</span><strong>{watch.label}</strong></div><p>{alertsStatus === "loading" ? "Checking official NWS alerts…" : alertsStatus === "unavailable" ? "NWS alert check unavailable — verify directly" : pointAlerts.length ? `${pointAlerts.length} active NWS alert${pointAlerts.length === 1 ? "" : "s"} · ${[...pointAlerts].sort((a, b) => alertPriority(a.event) - alertPriority(b.event))[0].event}` : "No active NWS alert returned for this point"}</p><a href="#watch">Local details ↓</a></div><div className="history-section" id="history"><div className="section-heading"><div><h2>Observed history</h2><p>NHC preliminary best-track observations</p></div></div><div className="trend-stats"><div><span>Wind change</span><b>{signed(data.observed.trend.wind_change_mph, "mph")}</b></div><div><span>Pressure change</span><b>{signed(data.observed.trend.pressure_change_mb, "mb")}</b></div></div><TrendChart data={data}/></div></div><Suspense fallback={<div className="map-fallback">Loading track map…</div>}><HurricaneMap data={data} token={token} onCapture={registerCapture} watch={watch}/></Suspense></section>
      <section className="source-banner"><p>Code Black track: experimental · NHC track: official</p><a href={data.official.advisory_url ?? "https://www.nhc.noaa.gov/"} target="_blank" rel="noreferrer">NHC advisory ↗</a></section>
      <div className="local-grid"><section className="watch-panel" id="watch" aria-label="Watch location"><div className="watch-panel__intro"><span className="eyebrow">LOCAL WATCH</span><h2>{watch.label}</h2></div><button type="button" className="watch-change" onClick={() => { setEditingWatch((open) => !open); setCandidates([]); setSearchError(null); }}>{editingWatch ? "Close" : "Change location"}</button>
        {editingWatch && <div className="watch-search"><form onSubmit={(event) => void searchAddress(event)}><label htmlFor="watch-address">Search US address or place</label><div><input id="watch-address" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Street address, city, state, ZIP" autoComplete="street-address" maxLength={256}/><button type="submit" disabled={searching}>{searching ? "Searching…" : "Find location"}</button></div></form>{searchError && <p role="alert">{searchError}</p>}{candidates.length > 0 && <div className="watch-results"><strong>Select the correct location</strong>{candidates.map((candidate, index) => <button type="button" key={`${candidate.latitude}-${candidate.longitude}-${index}`} onClick={() => selectWatch(candidate)}>{candidate.label}</button>)}</div>}<button type="button" className="watch-reset" onClick={() => selectWatch(DEFAULT_WATCH)}>Use Grand Bay, AL</button></div>}
        <div className="watch-distances"><div><span>Current center</span><strong>{proximity?.currentMiles == null ? "Unavailable" : `${proximity.currentMiles} mi away`}</strong></div></div><p className="watch-caution">Center distance does not predict local impacts. Follow NWS alerts and evacuation orders.</p></section>
      <section className="alerts-section" id="alerts"><div className="section-heading"><div><h2>NWS alerts</h2><p>Checked {displayTime(alertsCheckedAt)}</p></div><a href={`https://forecast.weather.gov/MapClick.php?lat=${watch.latitude}&lon=${watch.longitude}`} target="_blank" rel="noreferrer">Local NWS forecast ↗</a></div>
        {alertsStatus === "loading" ? <p className="empty">Checking NWS alerts for this location…</p> : alertsStatus === "unavailable" ? <p className="empty">NWS alerts could not be checked right now. Verify directly with NWS; this is not an all-clear.</p> : pointAlerts.length ? <div className="alert-list">{[...pointAlerts].sort((a, b) => alertPriority(a.event) - alertPriority(b.event)).map((alert, index) => <a key={`${alert.event}-${index}`} href={alert.url ?? "https://www.weather.gov/"} target="_blank" rel="noreferrer"><strong>{alert.event}</strong><span>{alertTiming(alert, now)}</span><small>Official NWS alert ↗</small></a>)}</div> : <p className="empty">No active NWS alert was returned for this point at this check. Keep monitoring official sources.</p>}</section></div>
      <LiveCameras data={data}/>
      <section className="lower-grid"><ModelGuidance data={data}/></section>
      <section className="share-section"><h2>Share this briefing</h2><div className="share-actions"><button type="button" disabled={exporting} onClick={() => void exportImage()}>{exporting ? "Creating image…" : "Download one-page image"}</button><button type="button" onClick={() => void copyLink()}>{copyState === "copied" ? "Link copied" : copyState === "failed" ? "Copy unavailable" : "Copy public link"}</button></div></section>
      <footer><div><strong>CODE BLACK / TROPICS</strong><p>Aegis analysis is experimental, not an official forecast. Follow NHC, NWS, and local officials for protective decisions.</p></div><div><a href={data.official.advisory_url ?? "https://www.nhc.noaa.gov/"}>NHC advisory ↗</a><a href={data.official.discussion_url ?? "https://www.nhc.noaa.gov/"}>NHC discussion ↗</a><a href="https://www.weather.gov/">NWS alerts ↗</a></div></footer>
    </> }</main></div>;
}

export default App;
