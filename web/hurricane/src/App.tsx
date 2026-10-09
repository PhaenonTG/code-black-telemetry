import { useCallback, useEffect, useMemo, useState } from "react";
import HurricaneMap from "./HurricaneMap";
import { saveBriefingImage } from "./briefingImage";
import type { PublicHurricane } from "./types";
import { displayTime, signed } from "./types";
import { DEFAULT_WATCH, fetchPointAlerts, watchSummary } from "./watchLocation";
import type { PointAlert, WatchLocation } from "./watchLocation";

const dataUrl = import.meta.env.DEV ? "/api/hurricane" : "https://ops.codeblackwx.com/api/public/hurricane";
const tokenUrl = import.meta.env.DEV ? "/api/mapbox-token" : "https://ops.codeblackwx.com/overlay-core/mapbox-token";
const ageMinutes = (value: string | null | undefined) => value ? Math.round((Date.now() - Date.parse(value)) / 60000) : Infinity;
const modelNames: Record<string, string> = { HFAI: "HAFS-A", HFBI: "HAFS-B", AVNI: "GFS", HCCA: "HCCA", TVCN: "TVCN" };

function AegisAssessment({ data, watch }: { data: PublicHurricane; watch: WatchLocation }) {
  const projection = data.projection;
  const at48 = projection.points.find((point) => point.hour === 48);
  const at24 = projection.points.find((point) => point.hour === 24);
  const independent = projection.member_ids?.map((id) => modelNames[id] ?? id).join(", ") ?? "no models";
  const shifted = data.guidance.models.filter((model) => model.shift_48h_miles != null).sort((a, b) => (b.shift_48h_miles ?? 0) - (a.shift_48h_miles ?? 0))[0];
  const nearby = watchSummary(data, watch);
  return <aside className="analysis-panel" id="analysis"><div className="analysis-title"><h2>Aegis projection</h2><span>Experimental</span></div>
    {projection.status === "ready" ? <><p className="analysis-lead">A live, equal-weight synthesis of {independent}. It redraws when new model cycles arrive.</p>
      <div className="analysis-callout"><strong>At +48 hours</strong><b>{at48 ? `${at48.spread_miles} mi` : "—"}</b><span>Separation between the farthest member centers, not a probability or impact radius.</span></div>
      <h3>What Aegis sees</h3><ul className="evidence-list"><li>Each independent model contributes one center position at the same forecast-valid time. Consensus aids are excluded to avoid double-counting.</li>
        <li>{at24 && at48 ? `Member spread ${at48.spread_miles >= at24.spread_miles ? "widens" : "narrows"} from ${at24.spread_miles} mi at +24h to ${at48.spread_miles} mi at +48h. This is track divergence, not calibrated uncertainty.` : "A comparable +24h to +48h spread trend is not available."}</li>
        <li>{data.guidance.wind_48h_mph_range?.length === 2 ? `Available +48h model maximum-wind guidance spans ${data.guidance.wind_48h_mph_range[0]}–${data.guidance.wind_48h_mph_range[1]} mph; these are center-intensity estimates, not local winds.` : "Comparable model intensity guidance is not available."}</li>
        <li>{shifted ? `${shifted.name} moved ${shifted.shift_48h_miles} mi at the comparable 48-hour valid time versus its prior cycle.` : "Prior-cycle shift is not available yet."}</li>
        <li>{nearby.aegis ? `For the selected watch location, the closest Aegis projected storm center is ${nearby.aegis.miles} mi away at +${nearby.aegis.point.hour}h. Center distance does not predict local impacts.` : "A location-specific Aegis track distance is not available."}</li></ul>
      <p className="method-note">{projection.method}</p></> : <p className="analysis-lead">Aegis projection is unavailable until at least two independent tracks cover multiple valid times. The NHC forecast remains visible.</p>}
    <div className="safety-note"><strong>Read this first</strong><p>{data.disclosure}</p></div>
  </aside>;
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
  const [capture, setCapture] = useState<(() => string | null) | null>(null);
  const [watch, setWatch] = useState<WatchLocation>(DEFAULT_WATCH);
  const [editingWatch, setEditingWatch] = useState(false), [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false), [searchError, setSearchError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<WatchLocation[]>([]);
  const [pointAlerts, setPointAlerts] = useState<PointAlert[]>([]), [alertsStatus, setAlertsStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const registerCapture = useCallback((value: (() => string | null) | null) => setCapture(() => value), []);
  const refresh = useCallback(async () => {
    try { const response = await fetch(dataUrl, { cache: "no-store" }); if (!response.ok) throw new Error(`Feed returned ${response.status}`);
      const next = await response.json() as PublicHurricane; setData(next); setError(null);
    } catch { setError("The latest hurricane analysis could not be loaded. Please use the official NHC forecast linked below."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); const interval = window.setInterval(() => void refresh(), 5 * 60_000); return () => clearInterval(interval); }, [refresh]);
  useEffect(() => { let alive = true; fetch(tokenUrl).then((response) => response.json()).then((body) => { if (alive && typeof body.token === "string") setToken(body.token); }).catch(() => {}); return () => { alive = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setAlertsStatus("loading"); setPointAlerts([]);
    fetchPointAlerts(watch, controller.signal).then((alerts) => { setPointAlerts(alerts); setAlertsStatus("ready"); })
      .catch(() => { if (!controller.signal.aborted) setAlertsStatus("unavailable"); });
    return () => controller.abort();
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
  const stale = useMemo(() => data ? ageMinutes(data.checked_at) > 90 || ageMinutes(data.guidance.latest_cycle) > 900 : false, [data]);
  const proximity = useMemo(() => data ? watchSummary(data, watch) : null, [data, watch]);
  const exportImage = async () => { if (!data) return; setExporting(true); try { await saveBriefingImage(data, capture?.() ?? null, watch, pointAlerts, alertsStatus); } catch { setError("The image could not be created on this device. Try print / PDF instead."); } finally { setExporting(false); } };
  return <div className="site-shell"><header className="site-header"><a href="/" className="brand"><span className="brand-mark">C<span>B</span></span><span>CODE BLACK <em>AEGIS</em></span></a>
    <nav aria-label="Primary"><a href="#projection">Projection</a><a href="#models">Models</a><a href="#history">History</a><a href="#alerts">Alerts</a></nav><a className="official-link" href="https://www.nhc.noaa.gov/" target="_blank" rel="noreferrer">Official NHC ↗</a></header>
    <main>{loading && !data ? <div className="loading">Loading current hurricane analysis…</div> : !data ? <div className="failure"><h1>Analysis unavailable</h1><p>{error}</p><a href="https://www.nhc.noaa.gov/">View the official NHC forecast ↗</a></div> : <>
      <section className="storm-head"><div><h1>{data.storm.classification === "HU" ? "Hurricane" : "Storm"} <em>{data.storm.name ?? "watch"}</em></h1><p>Public Aegis analysis of available hurricane guidance</p></div><div className="update-info"><strong>{data.status === "active" ? "LIVE ANALYSIS" : "LAST AVAILABLE ANALYSIS"}</strong><span>NHC update {displayTime(data.storm.last_update)}</span><span>Aegis checked {displayTime(data.checked_at)}</span><button onClick={() => void refresh()} type="button">Refresh ↻</button></div></section>
      {(error || stale || data.status !== "active") && <div className="status-warning" role="alert">{error ?? (data.status !== "active" ? "This storm is no longer listed as active. Showing the last available analysis." : "The analysis or model cycle is old. Consult the latest NHC advisory before making decisions.")}</div>}
      <div className="metrics"><div><span>Maximum sustained wind</span><strong>{data.storm.max_wind_mph == null ? "—" : `${data.storm.max_wind_mph} mph`}</strong></div><div><span>Minimum pressure</span><strong>{data.storm.pressure_mb == null ? "—" : `${data.storm.pressure_mb} mb`}</strong></div><div><span>Motion</span><strong>{data.storm.movement_degrees == null ? "—" : `${data.storm.movement_degrees}°`}{data.storm.movement_mph == null ? "" : ` · ${data.storm.movement_mph} mph`}</strong></div><div><span>Model cycle</span><strong>{displayTime(data.guidance.latest_cycle)}</strong></div></div>
      <section className="watch-panel" aria-label="Watch location"><div className="watch-panel__intro"><span className="eyebrow">WATCH LOCATION</span><h2>{watch.label}</h2><p>Change this location to update the marker, center-track distances, nearby NWS alerts, Aegis context, and downloaded image. Storm-wide measurements above stay the same.</p></div><button type="button" className="watch-change" onClick={() => { setEditingWatch((open) => !open); setCandidates([]); setSearchError(null); }}>{editingWatch ? "Close" : "Change location"}</button>
        {editingWatch && <div className="watch-search"><form onSubmit={(event) => void searchAddress(event)}><label htmlFor="watch-address">Search US address or place</label><div><input id="watch-address" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Street address, city, state, ZIP" autoComplete="street-address" maxLength={256}/><button type="submit" disabled={searching}>{searching ? "Searching…" : "Find location"}</button></div></form>{searchError && <p role="alert">{searchError}</p>}{candidates.length > 0 && <div className="watch-results"><strong>Select the correct location</strong>{candidates.map((candidate, index) => <button type="button" key={`${candidate.latitude}-${candidate.longitude}-${index}`} onClick={() => selectWatch(candidate)}>{candidate.label}</button>)}</div>}<button type="button" className="watch-reset" onClick={() => selectWatch(DEFAULT_WATCH)}>Use default Grand Bay address</button></div>}
        <div className="watch-distances"><div><span>Current storm center</span><strong>{proximity?.currentMiles == null ? "Unavailable" : `${proximity.currentMiles} mi away`}</strong></div><div><span>Closest NHC forecast center</span><strong>{proximity?.official ? `${proximity.official.miles} mi · +${proximity.official.point.hour}h` : "Unavailable"}</strong></div><div><span>Closest Aegis blended center</span><strong>{proximity?.aegis ? `${proximity.aegis.miles} mi · +${proximity.aegis.point.hour}h` : "Unavailable"}</strong></div></div><p className="watch-caution">Track-center distance is not a forecast of wind, surge, rain, or tornado impacts at this location. Follow local NWS alerts and evacuation orders.</p></section>
      <section className="projection-grid" id="projection"><HurricaneMap data={data} token={token} onCapture={registerCapture} watch={watch}/><AegisAssessment data={data} watch={watch}/></section>
      <section className="source-banner"><p><b>Aegis is not the National Hurricane Center.</b> The cyan track is an experimental model-center blend. The dashed white track and cone are official NHC guidance. Neither line predicts impacts at an address.</p><a href={data.official.advisory_url ?? "https://www.nhc.noaa.gov/"} target="_blank" rel="noreferrer">Read official advisory ↗</a></section>
      <section className="lower-grid"><div className="models-section" id="models"><div className="section-heading"><div><h2>Model guidance</h2><p>Most recent available cycle per aid; some cycles may differ.</p></div><span>{data.guidance.status === "ready" ? `${data.guidance.models.length} aids` : "Unavailable"}</span></div>
        <div className="model-table-wrap"><table><thead><tr><th>Guidance</th><th>Cycle</th><th>48h shift vs prior</th></tr></thead><tbody>{data.guidance.models.map((model) => <tr key={model.id}><td><i className={`model-dot model-dot--${model.id}`}/>{model.name}</td><td>{displayTime(model.cycle)}</td><td>{model.shift_48h_miles == null ? "Not comparable" : `${model.shift_48h_miles} mi`}</td></tr>)}</tbody></table></div>
        <p className="table-note">HCCA and TVCN are consensus aids, displayed for context but not counted as independent members in the Aegis blend. Track shifts compare the same valid time.</p></div>
      <div className="history-section" id="history"><div className="section-heading"><div><h2>Observed history</h2><p>NHC preliminary best-track observations</p></div></div><div className="trend-stats"><div><span>Wind change</span><b>{signed(data.observed.trend.wind_change_mph, "mph")}</b></div><div><span>Pressure change</span><b>{signed(data.observed.trend.pressure_change_mb, "mb")}</b></div></div><TrendChart data={data}/></div></section>
      <section className="alerts-section" id="alerts"><div className="section-heading"><div><h2>Alerts at watch location</h2><p>Active NWS alerts returned for {watch.label}. Check the official alert for its exact coverage and instructions.</p></div><a href={`https://forecast.weather.gov/MapClick.php?lat=${watch.latitude}&lon=${watch.longitude}`} target="_blank" rel="noreferrer">Local NWS forecast ↗</a></div>
        {alertsStatus === "loading" ? <p className="empty">Checking NWS alerts for this location…</p> : alertsStatus === "unavailable" ? <p className="empty">NWS alerts could not be checked right now. Do not treat this as an all-clear; use the official local forecast.</p> : pointAlerts.length ? <div className="alert-list">{pointAlerts.map((alert, index) => <a key={`${alert.event}-${index}`} href={alert.url ?? "https://www.weather.gov/"} target="_blank" rel="noreferrer"><strong>{alert.event}</strong><span>{alert.headline}</span><small>{alert.expires ? `Expires ${displayTime(alert.expires)}` : "Expiration unavailable"} ↗</small></a>)}</div> : <p className="empty">No active NWS alert was returned for this point at this check. Keep monitoring official sources.</p>}</section>
      <section className="share-section"><div><h2>Take the briefing with you</h2><p>Download an image for the selected watch location. The public link always opens with the default Grand Bay address; other selections are only for this visit.</p></div><div className="share-actions"><button type="button" disabled={exporting} onClick={() => void exportImage()}>{exporting ? "Creating image…" : "Download one-page image"}</button><button type="button" onClick={() => void navigator.clipboard.writeText(window.location.origin)}>Copy public link</button></div></section>
      <footer><div><strong>CODE BLACK AEGIS</strong><p>Independent analysis for situational awareness. Never a substitute for official forecasts, warnings, or evacuation orders.</p></div><div><a href={data.official.advisory_url ?? "https://www.nhc.noaa.gov/"}>NHC advisory ↗</a><a href={data.official.discussion_url ?? "https://www.nhc.noaa.gov/"}>NHC discussion ↗</a><a href="https://www.weather.gov/">NWS alerts ↗</a></div></footer>
    </> }</main></div>;
}

export default App;
