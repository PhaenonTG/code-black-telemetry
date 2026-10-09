import { useCallback, useEffect, useMemo, useState } from "react";
import HurricaneMap from "./HurricaneMap";
import ModelGuidance from "./ModelGuidance";
import { saveBriefingImage } from "./briefingImage";
import type { PublicHurricane } from "./types";
import { displayTime, signed } from "./types";
import { DEFAULT_WATCH, fetchPointAlerts, watchSummary } from "./watchLocation";
import type { PointAlert, WatchLocation } from "./watchLocation";
import codeblackShield from "../../../src/assets/codeblack-shield.png";

const dataUrl = import.meta.env.DEV ? "/api/hurricane" : "https://ops.codeblackwx.com/api/public/hurricane";
const tokenUrl = import.meta.env.DEV ? "/api/mapbox-token" : "https://ops.codeblackwx.com/overlay-core/mapbox-token";
const ageMinutes = (value: string | null | undefined) => value ? Math.round((Date.now() - Date.parse(value)) / 60000) : Infinity;
const alertPriority = (event: string) => /tornado warning/i.test(event) ? 0 : /hurricane warning/i.test(event) ? 1 : /storm surge warning/i.test(event) ? 2 : /tropical storm warning/i.test(event) ? 3 : /flood warning/i.test(event) ? 4 : /warning/i.test(event) ? 5 : /watch/i.test(event) ? 6 : 7;

function AegisBriefing({ data, watch }: { data: PublicHurricane; watch: WatchLocation }) {
  const ai = data.ai;
  const changedWatch = watch.latitude !== DEFAULT_WATCH.latitude || watch.longitude !== DEFAULT_WATCH.longitude;
  const changes = data.changes;
  const changeItems = [
    changes?.advisory_changed ? "New NHC advisory" : null,
    changes?.model_cycle_changes?.length ? `${changes.model_cycle_changes.length} model cycle${changes.model_cycle_changes.length === 1 ? "" : "s"} updated` : null,
    changes?.new_alerts?.length ? `${changes.new_alerts.length} new NWS alert${changes.new_alerts.length === 1 ? "" : "s"}` : null,
    changes?.new_report_count ? `${changes.new_report_count} new report product${changes.new_report_count === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return <section className="aegis-briefing" id="aegis" aria-label="Aegis analysis">
    <div className="aegis-briefing__head"><div><h2>Aegis analysis</h2><span className="aegis-briefing__state">Experimental interpretation · source-change review</span></div></div>
    <div className="aegis-delta"><span>Since previous source check</span><strong>{changeItems.length ? changeItems.join(" · ") : "No material source change detected"}</strong></div>
    {ai?.status === "ready" && ai.summary ? <><p className="aegis-briefing__summary">{ai.summary}</p>
      <div className="aegis-briefing__details"><div><h3>Signals in view</h3><ul>{ai.supporting_factors.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul></div>
        <div><h3>Uncertainty</h3><ul>{ai.uncertainties.slice(0, 2).map((item) => <li key={item}>{item}</li>)}</ul></div></div>
      <p className="aegis-briefing__meta">Aegis analyzed {displayTime(ai.analyzed_at)} · Sources checked {displayTime(data.checked_at)}</p></>
      : <p className="aegis-briefing__summary">A guarded Aegis briefing is not available for this source cycle. The official storm data and alerts below remain visible; this is not an all-clear.</p>}
    {changedWatch && <p className="aegis-briefing__scope">This narrative is anchored to the default Grand Bay watch area. Changing the location updates map distances and NWS alerts, but does not create a new location-specific AI analysis.</p>}
    <p className="aegis-briefing__caution">Aegis reviews official data when it changes; the cyan path is a deterministic model blend, not an AI-generated impact forecast. Radar imagery is shown on the map but is not yet analyzed by Aegis. <a href={data.official.discussion_url ?? "https://www.nhc.noaa.gov/"} target="_blank" rel="noreferrer">Read NHC discussion ↗</a></p>
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

function App() {
  const [data, setData] = useState<PublicHurricane | null>(null), [token, setToken] = useState<string | null>(null);
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
  const stale = useMemo(() => data ? ageMinutes(data.checked_at) > 90 || (data.status === "active" && ageMinutes(data.guidance.latest_cycle) > 900) : false, [data]);
  const proximity = useMemo(() => data ? watchSummary(data, watch) : null, [data, watch]);
  const exportImage = async () => { if (!data) return; setExporting(true); try { await saveBriefingImage(data, await capture?.() ?? null, watch, [...pointAlerts].sort((a, b) => alertPriority(a.event) - alertPriority(b.event)), alertsStatus); } catch { setError("The image could not be created on this device. Try print / PDF instead."); } finally { setExporting(false); } };
  const copyLink = async () => { try { await navigator.clipboard.writeText("https://tropics.codeblackwx.com/"); setCopyState("copied"); } catch { setCopyState("failed"); } window.setTimeout(() => setCopyState(null), 3000); };
  return <div className="site-shell"><header className="site-header"><a href="/" className="brand" aria-label="Tropics home"><img className="brand-shield" src={codeblackShield} alt=""/><span>CODE BLACK <em>TROPICS</em></span></a>
    <nav aria-label="Primary"><a href="#track">Track</a><a href="#aegis">Aegis</a><a href="#watch">Local watch</a><a href="#models">Models</a></nav><a className="official-link" href="https://www.nhc.noaa.gov/" target="_blank" rel="noreferrer">NHC official ↗</a></header>
    <main>{loading && !data ? <div className="loading">Loading Tropics…</div> : !data ? <div className="failure"><h1>Tropics unavailable</h1><p>{error}</p><a href="https://www.nhc.noaa.gov/">View the official NHC forecast ↗</a></div> : <>
      <section className="storm-head"><div><h1>Tropics</h1><p className="storm-name">{data.storm.classification === "HU" ? "Hurricane" : "Storm"} {data.storm.name ?? "watch"}</p></div><div className="update-info"><strong>{data.status === "active" && !stale ? "MONITORING NOW" : data.status === "post_storm_watch" && !stale ? "POST-STORM MONITORING" : "LATEST AVAILABLE"}</strong><span>NHC {displayTime(data.storm.last_update)}</span><span>Sources {displayTime(data.checked_at)}</span><button onClick={() => void refresh()} type="button">Refresh data ↻</button></div></section>
      {(error || stale || data.status !== "active") && <div className="status-warning" role="alert">{error ?? (stale ? "The latest source check is old. Consult NHC and NWS directly before making decisions." : data.status === "post_storm_watch" ? "NHC no longer lists this cyclone as active. Its track is historical; the NWS alert and report watch continues." : "This storm is no longer listed as active. The map shows its last published track.")}</div>}
      <div className="metrics"><div><span>Maximum sustained wind</span><strong>{data.storm.max_wind_mph == null ? "—" : `${data.storm.max_wind_mph} mph`}</strong></div><div><span>Minimum pressure</span><strong>{data.storm.pressure_mb == null ? "—" : `${data.storm.pressure_mb} mb`}</strong></div><div><span>Movement</span><strong>{data.storm.movement_degrees == null ? "—" : `${data.storm.movement_degrees}°`}{data.storm.movement_mph == null ? "" : ` · ${data.storm.movement_mph} mph`}</strong></div><div><span>Observed wind trend · {data.observed.trend.period_hours ?? "—"}h</span><strong>{signed(data.observed.trend.wind_change_mph, "mph")}</strong></div></div>
      <div className={`snapshot-watch ${pointAlerts.some((alert) => /warning/i.test(alert.event)) ? "snapshot-watch--warning" : ""}`}><div><span>WATCH LOCATION</span><strong>{watch.label}</strong></div><p>{alertsStatus === "loading" ? "Checking official NWS alerts…" : alertsStatus === "unavailable" ? "NWS alert check unavailable — verify directly" : pointAlerts.length ? `${pointAlerts.length} active NWS alert${pointAlerts.length === 1 ? "" : "s"} · ${[...pointAlerts].sort((a, b) => alertPriority(a.event) - alertPriority(b.event))[0].event}` : "No active NWS alert returned for this point"}</p><a href="#watch">Local details ↓</a></div>
      <section className="projection-grid" id="track"><HurricaneMap data={data} token={token} onCapture={registerCapture} watch={watch}/><AegisBriefing data={data} watch={watch}/></section>
      <section className="source-banner"><p><b>Official vs experimental:</b> White track and cone are NHC guidance; cyan is an algorithmic Aegis blend of independent model centers. It is not an AI-written forecast or an address-level impact prediction. Hazards can extend well beyond the cone.</p><a href={data.official.advisory_url ?? "https://www.nhc.noaa.gov/"} target="_blank" rel="noreferrer">Latest NHC advisory ↗</a></section>
      <div className="local-grid"><section className="watch-panel" id="watch" aria-label="Watch location"><div className="watch-panel__intro"><span className="eyebrow">LOCAL WATCH</span><h2>{watch.label}</h2><p>Change location to update the map, distances, and NWS alerts. The Aegis narrative stays anchored to Grand Bay.</p></div><button type="button" className="watch-change" onClick={() => { setEditingWatch((open) => !open); setCandidates([]); setSearchError(null); }}>{editingWatch ? "Close" : "Change location"}</button>
        {editingWatch && <div className="watch-search"><form onSubmit={(event) => void searchAddress(event)}><label htmlFor="watch-address">Search US address or place</label><div><input id="watch-address" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Street address, city, state, ZIP" autoComplete="street-address" maxLength={256}/><button type="submit" disabled={searching}>{searching ? "Searching…" : "Find location"}</button></div></form>{searchError && <p role="alert">{searchError}</p>}{candidates.length > 0 && <div className="watch-results"><strong>Select the correct location</strong>{candidates.map((candidate, index) => <button type="button" key={`${candidate.latitude}-${candidate.longitude}-${index}`} onClick={() => selectWatch(candidate)}>{candidate.label}</button>)}</div>}<button type="button" className="watch-reset" onClick={() => selectWatch(DEFAULT_WATCH)}>Use Grand Bay watch point</button></div>}
        <div className="watch-distances"><div><span>Current center</span><strong>{proximity?.currentMiles == null ? "Unavailable" : `${proximity.currentMiles} mi away`}</strong></div><div><span>Closest NHC forecast center</span><strong>{proximity?.official ? `${proximity.official.miles} mi · +${proximity.official.point.hour}h` : "Unavailable"}</strong></div><div><span>Closest Aegis blended center</span><strong>{proximity?.aegis ? `${proximity.aegis.miles} mi · +${proximity.aegis.point.hour}h` : "Unavailable"}</strong></div></div><p className="watch-caution">Center distance is not a prediction of wind, surge, rain, or tornado impacts. Follow local NWS alerts and evacuation orders.</p></section>
      <section className="alerts-section" id="alerts"><div className="section-heading"><div><h2>NWS alerts</h2><p>Checked {displayTime(alertsCheckedAt)} · Open the official product for coverage and instructions.</p></div><a href={`https://forecast.weather.gov/MapClick.php?lat=${watch.latitude}&lon=${watch.longitude}`} target="_blank" rel="noreferrer">Local NWS forecast ↗</a></div>
        {alertsStatus === "loading" ? <p className="empty">Checking NWS alerts for this location…</p> : alertsStatus === "unavailable" ? <p className="empty">NWS alerts could not be checked right now. Verify directly with NWS; this is not an all-clear.</p> : pointAlerts.length ? <div className="alert-list">{[...pointAlerts].sort((a, b) => alertPriority(a.event) - alertPriority(b.event)).map((alert, index) => <a key={`${alert.event}-${index}`} href={alert.url ?? "https://www.weather.gov/"} target="_blank" rel="noreferrer"><strong>{alert.event}</strong><span>{alert.headline}</span><small>{alert.expires ? `Expires ${displayTime(alert.expires)}` : "Expiration unavailable"} ↗</small></a>)}</div> : <p className="empty">No active NWS alert was returned for this point at this check. Keep monitoring official sources.</p>}</section></div>
      <section className="lower-grid"><ModelGuidance data={data}/>
      <div className="history-section" id="history"><div className="section-heading"><div><h2>Observed history</h2><p>NHC preliminary best-track observations</p></div></div><div className="trend-stats"><div><span>Wind change</span><b>{signed(data.observed.trend.wind_change_mph, "mph")}</b></div><div><span>Pressure change</span><b>{signed(data.observed.trend.pressure_change_mb, "mb")}</b></div></div><TrendChart data={data}/></div></section>
      <section className="share-section"><div><h2>Take the briefing with you</h2><p>Download an image for the selected watch location. The public link opens with the Grand Bay watch point; other selections are only for this visit.</p></div><div className="share-actions"><button type="button" disabled={exporting} onClick={() => void exportImage()}>{exporting ? "Creating image…" : "Download one-page image"}</button><button type="button" onClick={() => void copyLink()}>{copyState === "copied" ? "Link copied" : copyState === "failed" ? "Copy unavailable" : "Copy public link"}</button></div></section>
      <footer><div><strong>CODE BLACK / TROPICS</strong><p>Aegis analysis is experimental, not an official forecast. Follow NHC, NWS, and local officials for protective decisions.</p></div><div><a href={data.official.advisory_url ?? "https://www.nhc.noaa.gov/"}>NHC advisory ↗</a><a href={data.official.discussion_url ?? "https://www.nhc.noaa.gov/"}>NHC discussion ↗</a><a href="https://www.weather.gov/">NWS alerts ↗</a></div></footer>
    </> }</main></div>;
}

export default App;
