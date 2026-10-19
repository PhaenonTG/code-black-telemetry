import { useEffect, useState } from "react";
import { fetchForecast } from "../core/client";
import type { OpsCoreConfig } from "../core/config";
import "./ForecastTimeline.css";

type Hour = {
  run: string; run_time: string; forecast_hour: number; valid_time: string;
  available: boolean; unavailable_reason?: string; missing_fields: string[]; stale?: boolean;
  metrics: { key: string; label: string; value: number | null; unit: string }[];
};
type Timeline = { status: string; hours: Hour[]; notice: string };
type Runs = { runs: { run: string; run_time: string; available_hours: number[]; horizon: number }[] };
const timeLabel = (value: string) => new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", timeZoneName: "short" });

export function ForecastTimeline({ config, latitude, longitude }: { config: OpsCoreConfig; latitude: number; longitude: number }) {
  const [run, setRun] = useState("");
  const [validTime, setValidTime] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{ key: string; timeline: Timeline; runs: Runs } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `${latitude},${longitude},${run},${refresh}`;
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    const params = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude) });
    if (run) params.set("run", run);
    void Promise.all([
      fetchForecast<Timeline>(config, `point?${params}`, controller.signal),
      fetchForecast<Runs>(config, "runs", controller.signal),
    ]).then(([timeline, runs]) => {
      if (!controller.signal.aborted) setResult({ key, timeline, runs });
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Forecast unavailable");
    });
    return () => controller.abort();
  }, [config, latitude, longitude, run, refresh, key]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) setRefresh((value) => value + 1); }, 300_000);
    return () => window.clearInterval(timer);
  }, []);
  // Never show a previous point's numbers beneath a newly selected location.
  const data = result?.key === key ? result.timeline : null;
  const hours = data?.hours ?? [];
  const index = Math.max(0, hours.findIndex((hour) => hour.valid_time === validTime));
  const selected = hours[index];
  const previous = hours[index - 1];
  const gap = previous && new Date(selected.valid_time).getTime() - new Date(previous.valid_time).getTime() > 3_600_000;
  return <section className="forecast-timeline" aria-label="HRRR hourly forecast">
    <header><div><span>HRRR · HOURLY FORECAST</span><h2>Up to 48-hour guidance</h2></div>
      <button type="button" className="page-action-link" onClick={() => setRefresh((value) => value + 1)}>Refresh forecast</button></header>
    <p className="forecast-note">Hourly runs extend 18 hours. The 00/06/12/18 UTC runs extend 48 hours. Hours appear as they finish ingesting.</p>
    <label>Model run<select aria-label="Model run" value={run} onChange={(event) => { setRun(event.target.value); setValidTime(""); }}>
      <option value="">Best available · newest run for each hour</option>
      {(result?.runs.runs ?? []).map((item) => <option key={item.run} value={item.run}>{timeLabel(item.run_time)} · {item.available_hours.length}/{item.horizon + 1} hours</option>)}
    </select></label>
    {error ? <p role="alert">Forecast unavailable: {error}. Try Refresh forecast.</p> : !data ? <p role="status">Loading hourly forecast…</p> : !hours.length ? <p role="status">No forecast hours are published yet. Check again shortly.</p> : <>
      <label>Forecast valid time<select aria-label="Forecast valid time" value={selected.valid_time} onChange={(event) => setValidTime(event.target.value)}>
        {hours.map((hour) => <option key={hour.valid_time} value={hour.valid_time}>{timeLabel(hour.valid_time)} · f{hour.forecast_hour.toString().padStart(2, "0")}</option>)}
      </select></label>
      <input aria-label="Forecast hour" type="range" min={0} max={hours.length - 1} value={index} onChange={(event) => setValidTime(hours[Number(event.target.value)].valid_time)} />
      <p className="forecast-source">Valid {timeLabel(selected.valid_time)}<br />HRRR initialized {timeLabel(selected.run_time)} · f{selected.forecast_hour.toString().padStart(2, "0")}</p>
      {selected.stale && <p className="forecast-notice">Older model run — fresh guidance is not available for this selection. Check the initialization time.</p>}
      {previous && previous.run !== selected.run && <p className="forecast-notice">Run boundary: this hour comes from a different initialization.</p>}
      {gap && <p className="forecast-notice">There is a gap before this hour; missing hours are not interpolated.</p>}
      {selected.available ? <dl className="forecast-metrics">{selected.metrics.map((metric) => <div key={metric.key}><dt>{metric.label}</dt><dd>{metric.value == null ? "Unavailable" : `${metric.value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${metric.unit}`}</dd></div>)}</dl> : <p role="status">{selected.unavailable_reason ?? "This hour has no usable point data."}</p>}
      {selected.missing_fields.length > 0 && <details><summary>Missing source fields ({selected.missing_fields.length})</summary><p>{selected.missing_fields.join(", ")}</p></details>}
      <p className="forecast-note">{data.notice}</p>
    </>}
  </section>;
}
