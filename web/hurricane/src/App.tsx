import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ModelGuidance from "./ModelGuidance";
import LiveCameras from "./LiveCameras";
import Observations from "./Observations";
import { useLocalForecast } from "./LocalOverview";
import ForecastHistory, { SinceVisit } from "./ForecastHistory";
import LocalImpactTimeline from "./LocalImpactTimeline";
import BasinWatch from "./BasinWatch";
import { saveBriefingImage } from "./briefingPoster";
import type { PublicHurricane } from "./types";
import { displayTime, signed } from "./types";
import { DEFAULT_WATCH, fetchPointAlerts, watchSummary, savedWatch } from "./watchLocation";
import type { PointAlert, WatchLocation } from "./watchLocation";
import codeblackShield from "../../../src/assets/codeblack-shield.png";
import { hurricaneCategory } from "../../shared/hurricaneCategory";
import { compassDirection, currentAdvisoryTrend, estimateNorthernGulfLandfall, reviewedLandfall } from "./stormTelemetry";

const HurricaneMap = lazy(() => import("./HurricaneMap"));

const dataUrl = import.meta.env.DEV ? "/api/hurricane" : `https://ops.codeblackwx.com/api/public/hurricane?feed=v16&cb=${Math.floor(Date.now() / 60_000)}`;
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
  const decision = ai?.decision_record;
  const postLandfall = data.official.landfall?.status === "confirmed";
  const reviewCutoff = data.official.landfall?.observed_at ?? data.official.landfall?.at;
  const reviewed = (ai?.status === "ready" || ai?.status === "stale") && (!postLandfall || Boolean(reviewCutoff && ai.reviewed_at && ai.analyzed_at && Date.parse(ai.reviewed_at) >= Date.parse(reviewCutoff) && Date.parse(ai.analyzed_at) >= Date.parse(reviewCutoff)));
  const changedWatch = watch.latitude !== DEFAULT_WATCH.latitude || watch.longitude !== DEFAULT_WATCH.longitude;
  const changes = data.changes;
  const changeItems = [
    changes?.advisory_changed ? "New NHC advisory" : null,
    changes?.model_cycle_changes?.length ? `${changes.model_cycle_changes.length} model cycle${changes.model_cycle_changes.length === 1 ? "" : "s"} updated` : null,
    changes?.new_alerts?.length ? `${changes.new_alerts.length} new NWS alert${changes.new_alerts.length === 1 ? "" : "s"}` : null,
    changes?.new_report_count ? `${changes.new_report_count} new report product${changes.new_report_count === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return <section className="aegis-briefing" id="aegis" aria-label="Aegis analysis">
    <div className="aegis-briefing__head"><h2>{reviewed ? "Aegis briefing" : "Storm briefing"}</h2>{!reviewed && <span className="aegis-briefing__state aegis-briefing__state--missing">{postLandfall ? "Post-landfall review pending" : ai?.status === "stale" ? "Earlier review" : "Briefing unavailable"}</span>}</div>
    {changeItems.length > 0 && <div className="aegis-delta"><span>Changed since last check</span><strong>{changeItems.join(" · ")}</strong></div>}
    {reviewed && ai?.summary ? <><p className="aegis-briefing__summary">{ai.summary.split(/(?<=[.!?])\s+/).slice(0,2).join(" ")}</p>
      {ai.next_hour_outlook && <div className="aegis-briefing__outlook"><h3>Next hour</h3><p>{ai.next_hour_outlook}</p></div>}
      {decision && <details className="aegis-decision"><summary>Forecast decision & data requests <span>{ai.review_model} · {decision.confidence} confidence</span></summary>
        <div className="aegis-decision__grid"><div><h3>Track assessment</h3><p>{decision.track_assessment}</p>{decision.alternate_landfall && <p className="aegis-decision__alternate">Alternate: near {decision.alternate_landfall.nearest_city ?? decision.alternate_landfall.region} · {displayTime(decision.alternate_landfall.center_time)}</p>}</div>
          <div><h3>Intensity</h3><p>{decision.intensity_assessment}</p><p className="aegis-decision__alternate">Confidence: {decision.confidence_reason}</p></div></div>
        <div className="aegis-decision__hazards">{(["wind", "coastal_water", "flooding", "tornado"] as const).map((key) => decision.hazards[key] && <div key={key}><strong>{key === "coastal_water" ? "Coastal water" : key}</strong><p>{decision.hazards[key]}</p></div>)}</div>
        <div className="aegis-decision__grid">{decision.changes.length > 0 && <div><h3>What changed</h3><ul>{decision.changes.map((item) => <li key={item}>{item}</li>)}</ul></div>}
          {decision.next_hour_triggers.length > 0 && <div><h3>Reassessment triggers</h3><ul>{decision.next_hour_triggers.map((item) => <li key={item}>{item}</li>)}</ul></div>}</div>
        {(decision.data_requests.length > 0 || decision.missing_sources.length > 0) && <div className="aegis-decision__requests"><h3>What Aegis wants next</h3>{decision.data_requests.map((item) => <div key={`${item.source}-${item.question}`}><strong>{item.source} <small>{item.priority}</small></strong><p>{item.question} {item.why}</p></div>)}{decision.missing_sources.length > 0 && <p>Missing or stale: {decision.missing_sources.join(" · ")}</p>}<small>These are analysis requests, not automatically acquired data.</small></div>}
      </details>}
      <details className="briefing-expanded"><summary>Further analysis & evidence</summary>{ai.summary.split(/(?<=[.!?])\s+/).length > 2 && <p>{ai.summary.split(/(?<=[.!?])\s+/).slice(2).join(" ")}</p>}<div className="aegis-briefing__details"><div><h3>Signals in view</h3><ul>{ai.supporting_factors.map((item) => <li key={item}>{item}</li>)}</ul></div>
        <div><h3>Uncertainty</h3><ul>{ai.uncertainties.map((item) => <li key={item}>{item}</li>)}</ul></div></div><div className="briefing-evidence-links"><a href="#observations">Aircraft & station evidence ↓</a><a href="#models">Model comparison ↓</a><a href={data.official.discussion_url ?? "https://www.nhc.noaa.gov/"} target="_blank" rel="noreferrer">NHC reasoning ↗</a></div></details>
      <p className="aegis-briefing__meta">Reviewed {displayTime(ai.reviewed_at)} · Sources {displayTime(data.checked_at)}</p></> : <p className="aegis-briefing__summary aegis-briefing__summary--fallback">{postLandfall ? "Aegis is reviewing the confirmed crossing and current inland hazards. " : ""}<a href={data.official.landfall?.source ?? data.official.advisory_url ?? "https://www.nhc.noaa.gov/"} target="_blank" rel="noreferrer">Read the current NHC update ↗</a></p>}
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
    {[0, 1, 2, 3].map((line) => <g key={line}><line x1="48" x2="708" y1={50 + line * 56} y2={50 + line * 56} stroke="#303236" strokeWidth="1"/>
      <text x="5" y={56 + line * 56} fill="#a2a4a8" fontSize="15">{Math.round(hi - line * (hi - lo) / 3)}</text></g>)}
    <polyline points={coordinates} fill="none" stroke="#f4f4f5" strokeWidth="3" strokeLinejoin="round"/>
    {points.map((point, index) => <circle key={point.valid_time} cx={48 + index * 660 / (points.length - 1)} cy={218 - (point.wind_mph! - lo) / (hi - lo) * 168} r="3" fill="#f4f4f5"/>)}
    <text x="48" y="252" fill="#a2a4a8" fontSize="15">{displayTime(points[0].valid_time)}</text><text x="708" y="252" fill="#a2a4a8" fontSize="15" textAnchor="end">{displayTime(points.at(-1)?.valid_time)}</text>
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
const gulfCompactTime = (value: string) => gulfTime(value).replaceAll(", ", " ").replace(" at ", " · ");

function InstrumentDial({ value, unit, label, minimum, maximum, redline, inverted = false }: { value: number | null; unit: string; label: string; minimum: number; maximum: number; redline: number; inverted?: boolean }) {
  const bounded = Math.max(minimum, Math.min(maximum, value ?? minimum));
  const fraction = (bounded - minimum) / (maximum - minimum);
  const start = 150;
  const sweep = 240;
  const polar = (degrees: number, radius: number) => {
    const radians = degrees * Math.PI / 180;
    return { x: +(100 + Math.cos(radians) * radius).toFixed(2), y: +(100 + Math.sin(radians) * radius).toFixed(2) };
  };
  const arc = (from: number, to: number, radius: number) => {
    const a = polar(from, radius), b = polar(to, radius);
    return `M ${a.x} ${a.y} A ${radius} ${radius} 0 ${to - from > 180 ? 1 : 0} 1 ${b.x} ${b.y}`;
  };
  const redlineFraction = (redline - minimum) / (maximum - minimum);
  const warningStart = inverted ? start : start + sweep * redlineFraction;
  const warningEnd = inverted ? start + sweep * redlineFraction : start + sweep;
  const needle = polar(start + sweep * fraction, 64);
  return <div className="instrument-dial" aria-label={`${label}: ${value == null ? "unavailable" : `${value} ${unit}`}`}>
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <path d={arc(start, start + sweep, 77)} className="instrument-dial__arc"/>
      <path d={arc(warningStart, warningEnd, 77)} className="instrument-dial__redline"/>
      {Array.from({ length: 13 }, (_, index) => {
        const angle = start + sweep * index / 12;
        const outer = polar(angle, 87), inner = polar(angle, index % 3 === 0 ? 73 : 79);
        return <line key={index} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} className="instrument-dial__tick"/>;
      })}
      <line x1="100" y1="100" x2={needle.x} y2={needle.y} className="instrument-dial__needle"/>
      <circle cx="100" cy="100" r="5" className="instrument-dial__hub"/>
    </svg>
    <strong>{value == null ? "—" : value}<small>{unit}</small></strong><span>{label}</span>
  </div>;
}

function LandfallCard({ data, now, stale, watch, proximity }: { data: PublicHurricane; now: number; stale: boolean; watch: WatchLocation; proximity: ReturnType<typeof watchSummary> | null }) {
  const [clockNow, setClockNow] = useState(now);
  useEffect(() => { const timer = window.setInterval(() => setClockNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const officialLandfall = data.official.landfall;
  if (officialLandfall?.status === "confirmed") {
    const elapsed = Math.max(0, Math.floor((clockNow - Date.parse(officialLandfall.at)) / 1000));
    const clock = `${Math.floor(elapsed / 86400) ? `${Math.floor(elapsed / 86400)}d ` : ""}${String(Math.floor(elapsed % 86400 / 3600)).padStart(2, "0")}:${String(Math.floor(elapsed % 3600 / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
    return <section className="landfall-card landfall-card--confirmed" aria-label="NHC-confirmed landfall"><div className="landfall-card__title"><span>LANDFALL CONFIRMED</span><small>NHC OFFICIAL</small></div>
      <div className="landfall-card__grid"><div className="landfall-card__countdown"><span>Since center crossing</span><strong>{clock}</strong></div><div className="landfall-card__location"><span>Coastal location</span><strong>Near {officialLandfall.location}</strong></div><div className="landfall-card__watch"><span>Your watch location</span><strong>{watch.label}</strong><small>{proximity?.currentMiles == null ? "Center distance unavailable" : `${proximity.currentMiles} mi${proximity.centerBearing ? ` · ${proximity.centerBearing.direction} · ${proximity.centerBearing.degrees}° to center` : " from center"}`}</small></div><div className="landfall-card__time"><span>Confirmed time · Central</span><strong>{gulfCompactTime(officialLandfall.at)}</strong></div></div>
      <div className="landfall-card__window">The center is ashore; coastal and inland hazards can continue. <a href={officialLandfall.source} target="_blank" rel="noreferrer">NHC update ↗</a></div>
    </section>;
  }
  const aegis = estimateNorthernGulfLandfall(data, "aegis");
  const nhc = estimateNorthernGulfLandfall(data, "nhc");
  const reviewed = reviewedLandfall(data);
  const primary = reviewed ?? aegis ?? nhc;
  if (!primary) return null;
  const selectedNhc = Boolean(reviewed && data.ai?.landfall?.source === "NHC");
  const comparison = selectedNhc ? aegis : nhc;
  const differenceHours = aegis && nhc ? Math.round((Date.parse(aegis.centerTime) - Date.parse(nhc.centerTime)) / 3_600_000) : null;
  const secondsLeft = Math.max(0, Math.ceil((Date.parse(primary.centerTime) - clockNow) / 1000));
  const countdown = stale ? "SOURCE CHECK STALE" : secondsLeft > 0
    ? `${secondsLeft >= 86400 ? `${Math.floor(secondsLeft / 86400)}d ` : ""}${String(Math.floor(secondsLeft % 86400 / 3600)).padStart(2, "0")}:${String(Math.floor(secondsLeft % 3600 / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`
    : clockNow - Date.parse(primary.centerTime) < 6 * 3_600_000 ? "LANDFALL WINDOW" : "ESTIMATE PASSED";
  return <section className="landfall-card" aria-label="Estimated landfall">
    <div className="landfall-card__title"><span>LANDFALL</span><small>{reviewed || aegis ? "CODE BLACK EXPERIMENTAL" : "NHC CENTERLINE"}</small></div>
    <div className="landfall-card__grid"><div className="landfall-card__countdown"><span>To estimated center crossing</span><strong>{countdown}</strong></div><div className="landfall-card__location"><span>Estimated location</span><strong>{primary.nearestCity ? `Near ${primary.nearestCity}` : primary.region}</strong></div><div className="landfall-card__watch"><span>Your watch location</span><strong>{watch.label}</strong><small>{proximity?.currentMiles == null ? "Center distance unavailable" : `${proximity.currentMiles} mi${proximity.centerBearing ? ` · ${proximity.centerBearing.direction} · ${proximity.centerBearing.degrees}° to center` : " from center"}`}</small></div><div className="landfall-card__time"><span>Estimated time · Central</span><strong>~{gulfCompactTime(primary.centerTime)}</strong></div></div>
    <div className="landfall-card__window">Landfall window: {gulfTime(primary.windowStart)} – {gulfTime(primary.windowEnd)}</div>
    {differenceHours != null && Math.abs(differenceHours) >= 6 && <div className="landfall-card__divergence" role="status">NHC and Code Black center-crossing estimates differ by ~{Math.abs(differenceHours)}h. Check current NHC guidance.</div>}
    <details className="landfall-card__details"><summary>Guidance, sources & uncertainty</summary>
      <p>{reviewed ? `Aegis review ${displayTime(data.ai?.reviewed_at)} selected ${data.ai?.landfall?.source} guidance.` : aegis ? `${primary.members} independent model tracks in the Code Black estimate.` : "NHC official centerline estimate."} {comparison ? `${selectedNhc ? "Model blend" : "NHC centerline"}: ~${gulfTime(comparison.centerTime)} near ${comparison.region}.` : ""}</p>
      <p>Estimated center crossing is not a local-impact forecast; hazards can arrive earlier. <a href={data.official.discussion_url ?? "https://www.nhc.noaa.gov/"} target="_blank" rel="noreferrer">NHC discussion ↗</a></p>
    </details>
  </section>;
}

function PostLandfallImpact({ data, watch, alerts, alertsStatus, forecast, checkedAt, now }: { data: PublicHurricane; watch: WatchLocation; alerts: PointAlert[]; alertsStatus: "loading" | "ready" | "unavailable"; forecast: ReturnType<typeof useLocalForecast>; checkedAt: string | null; now: number }) {
  const priority = [...alerts].sort((a, b) => alertPriority(a.event) - alertPriority(b.event))[0];
  const currentHour = forecast.periods.find((period) => Date.parse(period.endTime) > now);
  const regionalTornado = data.regional_tornado_alerts?.filter((alert) => /tornado warning/i.test(alert.event ?? "")) ?? [];
  return <section className="impact-status" aria-label={`Current impact watch for ${watch.label}`}><div className="impact-status__head"><span className="eyebrow">POST-LANDFALL / LOCAL IMPACTS</span><h2>{watch.label}</h2><a href="#watch">Change location ↓</a></div>
    <div className="impact-status__grid"><a href="#alerts"><span>POINT ALERTS</span><strong>{alertsStatus === "ready" ? `${alerts.length} active` : alertsStatus === "loading" ? "Checking" : "Unavailable"}</strong><small>{priority?.event ?? (alertsStatus === "ready" ? "No active alert returned · not an all-clear" : "Verify with NWS")}</small></a>
      <a href="#alerts"><span>NWS HOURLY FORECAST</span><strong>{currentHour ? `${currentHour.windDirection} ${currentHour.windSpeed}` : forecast.status === "loading" ? "Loading" : "Unavailable"}</strong><small>{currentHour?.shortForecast ?? "Point forecast, not observed conditions"}</small></a>
      <a href="/reports"><span>REPORTS & RADAR</span><strong>{data.changes.new_report_count ? `${data.changes.new_report_count} new reports` : "Monitor reports"}</strong><small>{regionalTornado.length ? `${regionalTornado.length} regional tornado warning${regionalTornado.length === 1 ? "" : "s"}` : "Warnings, observations and local reports"}</small></a></div>
    <p>NWS point alerts checked {displayTime(checkedAt)} · Forecast and reports are not observations at this address. <a href={`https://forecast.weather.gov/MapClick.php?lat=${watch.latitude}&lon=${watch.longitude}`} target="_blank" rel="noreferrer">Official local forecast ↗</a></p>
  </section>;
}

function App() {
  const [data, setData] = useState<PublicHurricane | null>(null), [token, setToken] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(true), [exporting, setExporting] = useState(false);
  const [copyState, setCopyState] = useState<"copied" | "failed" | null>(null);
  const [capture, setCapture] = useState<(() => Promise<string | null>) | null>(null);
  const [watch, setWatch] = useState<WatchLocation>(savedWatch);
  const localForecast = useLocalForecast(watch);
  const [selectedTime,setSelectedTime] = useState(()=>Math.ceil(Date.now()/3600_000)*3600_000+6*3600_000);
  const [editingWatch, setEditingWatch] = useState(false), [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false), [searchError, setSearchError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<WatchLocation[]>([]);
  const [pointAlerts, setPointAlerts] = useState<PointAlert[]>([]), [alertsStatus, setAlertsStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [alertsCheckedAt, setAlertsCheckedAt] = useState<string | null>(null);
  const latestRefresh = useRef(0);
  const registerCapture = useCallback((value: (() => Promise<string | null>) | null) => setCapture(() => value), []);
  const refresh = useCallback(async () => {
    const requestId = ++latestRefresh.current;
    try { const response = await fetch(dataUrl, { cache: "no-store" }); if (!response.ok) throw new Error(`Feed returned ${response.status}`);
      const next = await response.json() as PublicHurricane;
      if (requestId !== latestRefresh.current) return;
      setData((current) => current && ((next.checked_at && current.checked_at && Date.parse(next.checked_at) < Date.parse(current.checked_at)) || JSON.stringify(current) === JSON.stringify(next)) ? current : next);
      setError(null);
    } catch { if (requestId === latestRefresh.current) setError("The latest hurricane analysis could not be loaded. Please use the official NHC forecast linked below."); }
    finally { if (requestId === latestRefresh.current) setLoading(false); }
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
  const selectWatch = (candidate: WatchLocation) => { setWatch(candidate); try {localStorage.setItem("tropics-watch",JSON.stringify(candidate));}catch{} setEditingWatch(false); setCandidates([]); setQuery(""); setSearchError(null); };
  const stale = useMemo(() => data ? ageMinutes(data.checked_at, now) > 90 || (data.status === "active" && ageMinutes(data.guidance.latest_cycle, now) > 900) : false, [data, now]);
  const proximity = useMemo(() => data ? watchSummary(data, watch) : null, [data, watch]);
  const category = data ? hurricaneCategory(data.storm.max_wind_mph, data.storm.classification) : null;
  const currentTrend = data ? currentAdvisoryTrend(data, watch) : null;
  const landed = data?.official.landfall?.status === "confirmed";
  const movementDirection = data ? compassDirection(data.storm.movement_degrees) : null;
  const exportImage = async (format: "portrait" | "landscape" = "portrait") => { if (!data) return; setExporting(true); try { await saveBriefingImage(data, await capture?.() ?? null, watch, [...pointAlerts].sort((a, b) => alertPriority(a.event) - alertPriority(b.event)), alertsStatus, localForecast, format); } catch { setError("The image could not be created on this device. Try print / PDF instead."); } finally { setExporting(false); } };
  const copyLink = async () => { try { await navigator.clipboard.writeText("https://tropics.codeblackwx.com/"); setCopyState("copied"); } catch { setCopyState("failed"); } window.setTimeout(() => setCopyState(null), 3000); };
  return <div className="site-shell"><nav className="mobile-nav" aria-label="Mobile"><a href="#overview">Overview</a><a href="#track">Map</a><a href="#watch">Local</a><a href="#basin-watch">Systems</a><a href="/reports">Reports</a></nav><header className="site-header"><a href="/" className="brand" aria-label="Tropics home"><img className="brand-shield" src={codeblackShield} alt=""/><span>CODE BLACK <em>TROPICS</em><small>FROM WATCHING TO WARNING</small></span></a>
    <nav aria-label="Primary"><a href="#track">Storm</a><a href="#aegis">Aegis</a><a href="#observations">Observations</a><a href="#watch">Local watch</a><a href="#models">Models</a><a href="#basin-watch">Systems</a><a href="/reports">Reports</a><a href="#cameras">Cameras</a></nav><a className="official-link" href="https://www.nhc.noaa.gov/" target="_blank" rel="noreferrer">NHC official ↗</a></header>
    <main>{loading && !data ? <div className="loading">Loading Tropics…</div> : !data ? <div className="failure"><h1>Tropics unavailable</h1><p>{error}</p><a href="https://www.nhc.noaa.gov/">View the official NHC forecast ↗</a></div> : <>
      <section className="storm-head" id="overview"><div><div className="storm-live"><i aria-hidden="true"/>{data.status === "active" && !stale ? "LIVE" : "LATEST"}{data.storm.id ? ` · ${data.storm.id}` : ""}</div><h1>{data.storm.classification === "HU" ? "Hurricane" : "Storm"} {data.storm.name ?? "watch"}</h1><div className="storm-classification">{category !== null && <span className={`storm-category ${category >= 3 ? "storm-category--major" : ""}`}>{data.status === "active" ? "CAT" : "LAST CAT"} <b>{category}</b></span>}<span>{data.storm.classification === "HU" ? category != null && category >= 3 ? "Major hurricane" : "Hurricane" : "Tropical cyclone"}</span></div></div><div className="update-info">{(stale || data.status !== "active") && <strong>{data.status === "post_storm_watch" && !stale ? "POST-STORM WATCH" : "LATEST AVAILABLE"}</strong>}<span>NHC {displayTime(data.storm.last_update)}</span><span>Sources {displayTime(data.checked_at)}</span><button onClick={() => void refresh()} type="button">Refresh data ↻</button></div></section>
      {(error || stale || data.status !== "active") && <div className="status-warning" role="alert">{error ?? (stale ? "The latest source check is old. Consult NHC and NWS directly before making decisions." : data.status === "post_storm_watch" ? "NHC no longer lists this cyclone as active. Its track is historical; the NWS alert and report watch continues." : "This storm is no longer listed as active. The map shows its last published track.")}</div>}
      <SinceVisit data={data}/><div className="metrics" aria-label="Latest NHC storm measurements"><div className={category != null && category >= 3 ? "metric--major" : ""}><strong>{data.storm.max_wind_mph == null ? "—" : data.storm.max_wind_mph}<small>mph</small></strong><span>Maximum sustained wind</span><TrendPill delta={currentTrend?.wind ?? null} unit="mph" elapsedHours={currentTrend?.elapsedHours ?? null} dangerWhen="up" label="Maximum sustained wind"/></div><div><strong>{data.storm.pressure_mb == null ? "—" : data.storm.pressure_mb}<small>mb</small></strong><span>Minimum pressure</span><TrendPill delta={currentTrend?.pressure ?? null} unit="mb" elapsedHours={currentTrend?.elapsedHours ?? null} dangerWhen="down" label="Minimum pressure"/></div><div><div className="metric-movement">{data.storm.movement_degrees == null ? null : <span className="metric-compass" aria-label={`Moving ${movementDirection ?? "unknown direction"}`}><span>N</span><svg viewBox="0 0 40 40" aria-hidden="true" style={{ transform: `rotate(${data.storm.movement_degrees}deg)` }}><path d="M20 5 26 26 20 22 14 26Z"/></svg></span>}<strong>{movementDirection ?? "—"}<small>{data.storm.movement_mph == null ? "" : `${data.storm.movement_mph} mph`}</small></strong></div><span>Forward motion · {data.storm.movement_degrees == null ? "direction unavailable" : `${data.storm.movement_degrees}°`}</span></div></div>
      <LandfallCard data={data} now={now} stale={stale} watch={watch} proximity={proximity}/>
      {landed && <PostLandfallImpact data={data} watch={watch} alerts={pointAlerts} alertsStatus={alertsStatus} forecast={localForecast} checkedAt={alertsCheckedAt} now={now}/>}
      {(data.regional_tornado_alerts?.length ?? 0) > 0 && <section className="regional-severe" role="alert" aria-label="Active regional tornado alerts"><div><span>Regional severe</span><strong>{data.regional_tornado_alerts?.some((alert) => /warning/i.test(alert.event ?? "")) ? "Tornado Warning active" : "Tornado Watch active"}</strong></div><p>{data.regional_tornado_alerts?.length === 1 ? data.regional_tornado_alerts[0].headline : `${data.regional_tornado_alerts?.length} active tornado watches or warnings in the Gulf Coast monitoring area.`}</p><details><summary>Coverage & official alerts</summary>{data.regional_tornado_alerts?.map((alert, index) => <p key={`${alert.url ?? alert.event}-${index}`}><b>{alert.event}</b>{alert.areas ? ` · ${alert.areas}` : ""} {alert.expires ? `· through ${displayTime(alert.expires)}` : ""} <a href={alert.url ?? "https://www.weather.gov/"} target="_blank" rel="noreferrer">NWS ↗</a></p>)}</details></section>}
      <section className="projection-grid" id="track"><div className="cockpit-track"><InstrumentDial value={data.storm.max_wind_mph} unit="mph" label="Sustained wind" minimum={0} maximum={180} redline={111}/><Suspense fallback={<div className="map-fallback">Loading live storm map…</div>}><HurricaneMap data={data} token={token} onCapture={registerCapture} watch={watch}/></Suspense><InstrumentDial value={data.storm.pressure_mb} unit="mb" label="Central pressure" minimum={900} maximum={1020} redline={960} inverted/></div><div className="dashboard-intel"><AegisBriefing data={data} watch={watch}/><details className="history-section history-disclosure" id="history"><summary>Observed history</summary><div className="section-heading"><div><p>NHC preliminary best-track observations</p></div></div><div className="trend-stats"><div><span>Wind change</span><b>{signed(data.observed.trend.wind_change_mph, "mph")}</b></div><div><span>Pressure change</span><b>{signed(data.observed.trend.pressure_change_mb, "mb")}</b></div></div><TrendChart data={data}/></details></div></section>
      <LiveCameras data={data}/>
      <Observations data={data}/>
      <div className="local-grid"><section className="watch-panel" id="watch" aria-label="Watch location"><div className="watch-panel__intro"><span className="eyebrow">LOCAL WATCH</span><h2>{watch.label}</h2></div><button type="button" className="watch-change" onClick={() => { setEditingWatch((open) => !open); setCandidates([]); setSearchError(null); }}>{editingWatch ? "Close" : "Change location"}</button>
        {editingWatch && <div className="watch-search"><form onSubmit={(event) => void searchAddress(event)}><label htmlFor="watch-address">Search US address or place</label><div><input id="watch-address" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Street address, city, state, ZIP" autoComplete="street-address" maxLength={256}/><button type="submit" disabled={searching}>{searching ? "Searching…" : "Find location"}</button></div></form>{searchError && <p role="alert">{searchError}</p>}{candidates.length > 0 && <div className="watch-results"><strong>Select the correct location</strong>{candidates.map((candidate, index) => <button type="button" key={`${candidate.latitude}-${candidate.longitude}-${index}`} onClick={() => selectWatch(candidate)}>{candidate.label}</button>)}</div>}<button type="button" className="watch-reset" onClick={() => selectWatch(DEFAULT_WATCH)}>Use Grand Bay, AL</button></div>}
        </section>
      <section className="alerts-section" id="alerts"><details className="alerts-disclosure"><summary><span>NWS alerts</span><small>{alertsStatus === "ready" ? `${pointAlerts.length} active` : alertsStatus === "loading" ? "Checking…" : "Unavailable"}</small><i aria-hidden="true">⌄</i></summary><div className="alerts-disclosure__body"><div className="section-heading"><div><p>Checked {displayTime(alertsCheckedAt)}</p></div><a href={`https://forecast.weather.gov/MapClick.php?lat=${watch.latitude}&lon=${watch.longitude}`} target="_blank" rel="noreferrer">Local NWS forecast ↗</a></div>
        {alertsStatus === "ready" && <LocalImpactTimeline alerts={pointAlerts}/>}
        {alertsStatus === "loading" ? <p className="empty">Checking NWS alerts for this location…</p> : alertsStatus === "unavailable" ? <p className="empty">NWS alerts could not be checked right now. Verify directly with NWS; this is not an all-clear.</p> : pointAlerts.length ? <div className="alert-list">{[...pointAlerts].sort((a, b) => alertPriority(a.event) - alertPriority(b.event)).map((alert, index) => <details key={`${alert.event}-${index}`} className="alert-item"><summary><strong>{alert.event}</strong><span>{alertTiming(alert, now)}</span><i aria-hidden="true">⌄</i></summary><div className="alert-item__body">{alert.description ? <p>{alert.description}</p> : <p>{alert.headline}</p>}<a href={alert.url ?? "https://www.weather.gov/"} target="_blank" rel="noreferrer">Open official NWS alert ↗</a></div></details>)}</div> : <p className="empty">No active NWS alert was returned for this point at this check. Keep monitoring official sources.</p>}</div></details></section>
      </div>
      <section className="lower-grid"><ModelGuidance data={data} selectedTime={selectedTime} onTimeChange={setSelectedTime}/><ForecastHistory data={data}/></section>
      <BasinWatch currentStormId={data.storm.id}/>
      <section className="share-section"><h2>Share this briefing</h2><div className="share-actions"><button type="button" disabled={exporting} onClick={() => void exportImage()}>{exporting ? "Creating image…" : "Download phone briefing"}</button><button type="button" disabled={exporting} onClick={() => void exportImage("landscape")}>Download landscape briefing</button><button type="button" onClick={() => void copyLink()}>{copyState === "copied" ? "Link copied" : copyState === "failed" ? "Copy unavailable" : "Copy public link"}</button></div></section>
      <footer><div><strong>CODE BLACK / TROPICS</strong><p>Aegis analysis is experimental, not an official forecast. Follow NHC, NWS, and local officials for protective decisions.</p></div><div><a href={data.official.advisory_url ?? "https://www.nhc.noaa.gov/"}>NHC advisory ↗</a><a href={data.official.discussion_url ?? "https://www.nhc.noaa.gov/"}>NHC discussion ↗</a><a href="https://www.weather.gov/">NWS alerts ↗</a></div></footer>
    </> }</main></div>;
}

export default App;
