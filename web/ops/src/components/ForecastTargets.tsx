import { useEffect, useRef, useState } from "react";
import { fetchForecast } from "../core/client";
import type { OpsCoreConfig } from "../core/config";
import { routeForecastTargets, type Arrival } from "../core/forecastRouting";
import { mapboxAccessToken } from "../../../../src/services/mapTiles";

type Candidate = {
  latitude: number; longitude: number; valid_time: string; run_time: string; run: string;
  forecast_hour: number; candidate_index: number; classification: string; score: number;
  distance_miles: number; hazard_screening_indices: Record<string, number>; missing_fields: string[];
};
type Result = { candidates: Candidate[]; notice: string };
const localNow = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const label = (value: string) => new Date(value).toLocaleString();

export function ForecastTargets({ config, latitude, longitude }: { config: OpsCoreConfig; latitude: number; longitude: number }) {
  const [radius, setRadius] = useState(500);
  const [departure, setDeparture] = useState(localNow);
  const [margin, setMargin] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ candidates: (Candidate & { arrival: Arrival })[]; notice: string } | null>(null);
  const [reviews, setReviews] = useState<Record<string, string>>({});
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
      const data = await fetchForecast<Result>(config, `targets?${params}`, active.signal);
      const routed = await routeForecastTargets(data.candidates, { latitude, longitude }, mapboxAccessToken(), date.toISOString(), margin, active.signal);
      if (!active.signal.aborted) setResult({ candidates: routed.sort((a, b) => Number(b.arrival.status === "reachable") - Number(a.arrival.status === "reachable")).slice(0, 5), notice: data.notice });
    } catch (cause) { if (!active.signal.aborted) setError(cause instanceof Error ? cause.message : "Target search unavailable"); }
    finally { if (!active.signal.aborted) setBusy(false); }
  }
  async function review(candidate: Candidate) {
    const id = `${candidate.run}/${candidate.forecast_hour}/${candidate.candidate_index}`;
    setReviews((previous) => ({ ...previous, [id]: "Reviewing forecast evidence…" }));
    try {
      const params = new URLSearchParams({ run: candidate.run, forecast_hour: String(candidate.forecast_hour), candidate_index: String(candidate.candidate_index) });
      const signal = controller.current?.signal;
      const deadline = Date.now() + 110_000;
      while (!signal?.aborted && Date.now() < deadline) {
        const response = await fetchForecast<{ summary: string; status: string }>(config, `review?${params}`, signal);
        if (signal?.aborted) return;
        setReviews((previous) => ({ ...previous, [id]: `${response.status === "ready" ? "AI advisory" : "AI status"}: ${response.summary}` }));
        if (response.status !== "pending") return;
        await new Promise((resolve) => window.setTimeout(resolve, 2500));
      }
      if (!signal?.aborted) setReviews((previous) => ({ ...previous, [id]: "AI review took too long. Numerical evidence remains available." }));
    } catch { setReviews((previous) => ({ ...previous, [id]: "AI review unavailable; use the numerical evidence." })); }
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
    {result && <><p className="forecast-note">{result.notice}</p>{!result.candidates.length && <p>No qualifying areas in the available forecast hours. This does not mean severe weather is impossible.</p>}
      {result.candidates.map((candidate) => {
        const id = `${candidate.run}/${candidate.forecast_hour}/${candidate.candidate_index}`;
        return <article className="forecast-target" key={id}>
          <h3>{candidate.latitude.toFixed(2)}, {candidate.longitude.toFixed(2)} · {candidate.distance_miles} mi</h3>
          <p>{candidate.classification === "forecast_storm" ? "Model forecasts convection" : "Conditional environment · storms may not form"}</p>
          <p className="forecast-source">Valid {label(candidate.valid_time)}<br />Run {label(candidate.run_time)} · f{candidate.forecast_hour}</p>
          <p>Route: {candidate.arrival.status === "unknown" ? "unknown — reachability not established" : `${candidate.arrival.duration_minutes} min · ${candidate.arrival.status === "reachable" ? "arrives before selected margin" : "too late for selected margin"}`}</p>
          <details><summary>Numerical screening evidence</summary><p>Environment index: {candidate.score.toFixed(2)}. These indices are not probabilities or calibrated threat levels.</p>{["tornado", "hail", "wind"].map((hazard) => <p key={hazard}>{hazard}: {candidate.hazard_screening_indices[hazard]?.toFixed(2) ?? "insufficient fields"}</p>)}<p>Missing: {candidate.missing_fields.join(", ") || "none of the screening fields"}</p></details>
          {import.meta.env.VITE_FORECAST_AI_ENABLED === "1" && <><button type="button" className="page-action-link" onClick={() => void review(candidate)}>Review with AI</button>{reviews[id] && <p>{reviews[id]}</p>}</>}
        </article>;
      })}</>}
  </section>;
}
