import { useEffect, useRef, useState } from "react";
import { fetchForecast } from "../core/client";
import type { OpsCoreConfig } from "../core/config";
import { routeForecastTargets, type Arrival } from "../core/forecastRouting";
import { mapboxAccessToken } from "../../../../src/services/mapTiles";

type Candidate = {
  latitude: number; longitude: number; valid_time: string; run_time: string; run: string;
  forecast_hour: number; candidate_index: number; classification: string; score: number;
  distance_miles: number; hazard_screening_indices: Record<string, number>; missing_fields: string[];
  briefing_status?: string; briefing_notice?: string; change_from_previous?: string;
  automatic_review?: { status?: string; summary?: string; advisory?: boolean; briefing?: { bottom_line?: string; why?: string; what_could_invalidate?: string; uncertainties?: string; storm_mode?: string; initiation?: string; attention?: string; data_boundary?: string } };
  rap_agreement?: { status?: string; model?: string; summary?: string; mlcape?: number; mlcin?: number };
};
type Result = { candidates: Candidate[]; notice: string };
type Alert = { id?: string; event?: string; headline?: string; severity?: string; effective?: string; expires?: string; description?: string; sender?: string };
type AlertsResult = { status: string; source: string; queried_at?: string; alerts: Alert[]; notice: string };
type Briefing = { run: string; run_time: string; generated_at?: string; targets: Array<{ latitude: number; longitude: number; score: number; classification: string; ai_review?: { summary?: string }; change_from_previous?: string }> };
type BriefingsResult = { status: string; history_hours: number; briefings: Briefing[]; notice: string };
type VerifiedEvent = { event_id?: string; event_type: string; begin?: string; latitude: number; longitude: number; distance_miles: number; tor_f_scale?: string; tor_length_miles?: number | null; tor_width_yards?: number | null; source?: string; state?: string; cz_name?: string; event_narrative?: string };
type VerifiedEventsResult = { status: string; events: VerifiedEvent[]; notice: string; synced_at?: string };
type AiBriefing = NonNullable<Candidate["automatic_review"]>["briefing"];
type ReviewResult = { message: string; briefing?: AiBriefing };
const localNow = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const label = (value: string) => new Date(value).toLocaleString();

export function ForecastTargets({ config, latitude, longitude }: { config: OpsCoreConfig; latitude: number; longitude: number }) {
  const [radius, setRadius] = useState(500);
  const [departure, setDeparture] = useState(localNow);
  const [margin, setMargin] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ candidates: (Candidate & { arrival: Arrival })[]; notice: string; alerts: AlertsResult | null; briefings: BriefingsResult | null; verified: VerifiedEventsResult | null } | null>(null);
  const [reviews, setReviews] = useState<Record<string, ReviewResult>>({});
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function search() {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setBusy(true); setError(""); setResult(null); setReviews({});
    try {
      const date = new Date(departure);
      if (!Number.isFinite(date.getTime()) || date.getTime() < Date.now() - 60_000) throw new Error("Choose a departure time now or in the future.");
      const params = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), radius_miles: String(radius) });
      const [data, alerts, briefings, verified] = await Promise.all([
        fetchForecast<Result>(config, `targets?${params}`, active.signal),
        fetchForecast<AlertsResult>(config, `alerts?${params}`, active.signal).catch(() => null),
        fetchForecast<BriefingsResult>(config, "briefings", active.signal).catch(() => null),
        fetchForecast<VerifiedEventsResult>(config, `verified-events?${params}`, active.signal).catch(() => null),
      ]);
      const routed = await routeForecastTargets(data.candidates, { latitude, longitude }, mapboxAccessToken(), date.toISOString(), margin, active.signal);
      if (!active.signal.aborted) setResult({ candidates: routed.sort((a, b) => Number(b.arrival.status === "reachable") - Number(a.arrival.status === "reachable")).slice(0, 5), notice: data.notice, alerts, briefings, verified });
    } catch (cause) { if (!active.signal.aborted) setError(cause instanceof Error ? cause.message : "Target search unavailable"); }
    finally { if (!active.signal.aborted) setBusy(false); }
  }
  async function review(candidate: Candidate) {
    const id = `${candidate.run}/${candidate.forecast_hour}/${candidate.candidate_index}`;
    setReviews((previous) => ({ ...previous, [id]: { message: "Reviewing forecast evidence…" }));
    try {
      const params = new URLSearchParams({ run: candidate.run, forecast_hour: String(candidate.forecast_hour), candidate_index: String(candidate.candidate_index) });
      const signal = controller.current?.signal;
      const deadline = Date.now() + 110_000;
      while (!signal?.aborted && Date.now() < deadline) {
        const response = await fetchForecast<{ summary: string; status: string; briefing?: AiBriefing }>(config, `review?${params}`, signal);
        if (signal?.aborted) return;
        setReviews((previous) => ({ ...previous, [id]: { message: `${response.status === "ready" ? "AI advisory" : "AI status"}: ${response.summary}`, briefing: response.briefing } }));
        if (response.status !== "pending") return;
        await new Promise((resolve) => window.setTimeout(resolve, 2500));
      }
      if (!signal?.aborted) setReviews((previous) => ({ ...previous, [id]: { message: "AI review took too long. Numerical evidence remains available." } }));
    } catch { setReviews((previous) => ({ ...previous, [id]: { message: "AI review unavailable; use the numerical evidence." } })); }
  }
  return <section className="forecast-timeline" aria-label="Experimental chase target screening">
    <header><div><span>EXPERIMENTAL · HRRR ONLY</span><h2>Potential target areas</h2></div></header>
    <p className="forecast-note">Confirm the selected map point as your departure origin: {latitude.toFixed(3)}, {longitude.toFixed(3)}. This is model screening, not a recommendation that a chase is safe.</p>
    <label>Search radius (miles)<input disabled={busy} type="number" min="25" max="1000" value={radius} onChange={(event) => { setRadius(Number(event.target.value)); setResult(null); }} /></label>
    <label>Departure (your local time)<input disabled={busy} type="datetime-local" value={departure} onChange={(event) => { setDeparture(event.target.value); setResult(null); }} /></label>
    <button type="button" disabled={busy} className="page-action-link" onClick={() => { setDeparture(localNow()); setResult(null); }}>Depart now</button>
    <label>Arrival margin (minutes)<input disabled={busy} type="number" min="0" max="180" value={margin} onChange={(event) => { setMargin(Number(event.target.value)); setResult(null); }} /></label>
    <button type="button" className="page-action-link" disabled={busy || radius < 25 || radius > 1000 || margin < 0 || margin > 180} onClick={() => void search()}>{busy ? "Checking forecast and routes…" : "Use this origin · Find areas"}</button>
    {error && <p role="alert">{error}</p>}
    {result && <><p className="forecast-note">{result.notice}</p>
      {result.alerts && <section className="forecast-alerts" aria-label="Live National Weather Service alerts">
        <h3>Live NWS alert context</h3><p className="forecast-source">{result.alerts.status === "ready" ? `${result.alerts.alerts.length} relevant active alert${result.alerts.alerts.length === 1 ? "" : "s"} near this origin` : "NWS alerts currently unavailable"}</p>
        {result.alerts.alerts.map((alert, index) => <details key={alert.id ?? `${alert.event}-${index}`}><summary>{alert.event ?? "Weather alert"} · {alert.severity ?? "unknown severity"}</summary><p>{alert.headline ?? "No headline supplied."}</p><p className="forecast-source">{alert.sender ?? "National Weather Service"}{alert.expires ? ` · expires ${label(alert.expires)}` : ""}</p>{alert.description && <p>{alert.description}</p>}</details>)}
        <p className="forecast-notice">{result.alerts.notice}</p>
      </section>}
      {result.briefings && <details className="forecast-history"><summary>Run briefing history · last {result.briefings.history_hours} hours</summary><p className="forecast-note">{result.briefings.notice}</p>{result.briefings.briefings.map((briefing) => <article key={briefing.run}><h3>{label(briefing.run_time)}</h3>{briefing.targets.map((target, index) => <p key={`${briefing.run}-${index}`}><strong>{target.classification === "forecast_storm" ? "Forecast storm" : "Conditional"}</strong> · {target.latitude.toFixed(2)}, {target.longitude.toFixed(2)} · index {target.score.toFixed(2)}{target.change_from_previous ? <><br />{target.change_from_previous}</> : null}{target.ai_review?.summary ? <><br />AI: {target.ai_review.summary}</> : null}</p>)}</article>)}</details>}
      {result.verified && <details className="forecast-history"><summary>Verified NCEI event history</summary><p className="forecast-note">{result.verified.notice}</p>{result.verified.events.slice(0, 10).map((event) => <article key={event.event_id ?? `${event.begin}-${event.latitude}`}><h3>{event.event_type}{event.tor_f_scale ? ` · ${event.tor_f_scale}` : ""} · {event.distance_miles} mi</h3><p>{event.begin ?? "Date unavailable"} · {event.cz_name ?? event.state ?? "Location unavailable"}<br />{event.source ?? "Source unavailable"}{event.tor_length_miles != null ? ` · ${event.tor_length_miles} mi path` : ""}{event.tor_width_yards != null ? ` · ${event.tor_width_yards} yd wide` : ""}{event.event_narrative ? <><br />{event.event_narrative}</> : null}</p></article>)}</details>}
      {!result.candidates.length && <p>No qualifying areas in the available forecast hours. This does not mean severe weather is impossible.</p>}
      {result.candidates.map((candidate) => {
        const id = `${candidate.run}/${candidate.forecast_hour}/${candidate.candidate_index}`;
        return <article className="forecast-target" key={id}>
          <h3>{candidate.latitude.toFixed(2)}, {candidate.longitude.toFixed(2)} · {candidate.distance_miles} mi</h3>
          <p>{candidate.classification === "forecast_storm" ? "Model forecasts convection" : "Conditional environment · storms may not form"}</p>
          <p className="forecast-source">Valid {label(candidate.valid_time)}<br />Run {label(candidate.run_time)} · f{candidate.forecast_hour}</p>
          <p>Route: {candidate.arrival.status === "unknown" ? "unknown — reachability not established" : `${candidate.arrival.duration_minutes} min · ${candidate.arrival.status === "reachable" ? "arrives before selected margin" : "too late for selected margin"}`}</p>
          {candidate.change_from_previous && <p className="forecast-change">{candidate.change_from_previous}</p>}
          <details><summary>Numerical screening evidence</summary><p>Environment index: {candidate.score.toFixed(2)}. These indices are not probabilities or calibrated threat levels.</p>{["tornado", "hail", "wind"].map((hazard) => <p key={hazard}>{hazard}: {candidate.hazard_screening_indices[hazard]?.toFixed(2) ?? "insufficient fields"}</p>)}<p>Missing: {candidate.missing_fields.join(", ") || "none of the screening fields"}</p></details>
          {candidate.rap_agreement && <p className="forecast-change"><strong>RAP agreement · {candidate.rap_agreement.status ?? "unknown"}:</strong> {candidate.rap_agreement.summary}</p>}
          {candidate.automatic_review?.briefing ? <details className="forecast-briefing" open><summary>Automatic AI briefing</summary><p><strong>Bottom line:</strong> {candidate.automatic_review.briefing.bottom_line}</p>{candidate.automatic_review.briefing.why && <p><strong>Why this area:</strong> {candidate.automatic_review.briefing.why}</p>}{candidate.automatic_review.briefing.initiation && <p><strong>Initiation:</strong> {candidate.automatic_review.briefing.initiation}</p>}{candidate.automatic_review.briefing.storm_mode && <p><strong>Storm mode:</strong> {candidate.automatic_review.briefing.storm_mode}</p>}{candidate.automatic_review.briefing.what_could_invalidate && <p><strong>What could invalidate it:</strong> {candidate.automatic_review.briefing.what_could_invalidate}</p>}{candidate.automatic_review.briefing.uncertainties && <p><strong>Uncertainty:</strong> {candidate.automatic_review.briefing.uncertainties}</p>}<p className="forecast-source">{candidate.automatic_review.briefing.data_boundary}</p></details> : candidate.automatic_review?.summary && <p className="forecast-briefing"><strong>Automatic briefing:</strong> {candidate.automatic_review.summary}</p>}
          {candidate.briefing_status === "pending" && <p className="forecast-source">Automatic briefing is being prepared for this completed model run.</p>}
          {import.meta.env.VITE_FORECAST_AI_ENABLED === "1" && <><button type="button" className="page-action-link" onClick={() => void review(candidate)}>Refresh AI review</button>{reviews[id] && <><p>{reviews[id].message}</p>{reviews[id].briefing?.why && <details className="forecast-briefing"><summary>AI findings</summary><p><strong>Why this area:</strong> {reviews[id].briefing.why}</p>{reviews[id].briefing.initiation && <p><strong>Initiation:</strong> {reviews[id].briefing.initiation}</p>{reviews[id].briefing.storm_mode && <p><strong>Storm mode:</strong> {reviews[id].briefing.storm_mode}</p>{reviews[id].briefing.what_could_invalidate && <p><strong>What could invalidate it:</strong> {reviews[id].briefing.what_could_invalidate}</p>{reviews[id].briefing.uncertainties && <p><strong>Uncertainty:</strong> {reviews[id].briefing.uncertainties}</p></details>}</>}</>}
        </article>;
      })}</>}
  </section>;
}
