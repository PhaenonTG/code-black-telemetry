import { useState } from "react";

type Field = { value?: number; unit?: string };
type Point = { latitude: number; longitude: number; fields?: Record<string, Field> };
type Hour = { run_time?: string; valid_time?: string; forecast_hour?: number; points?: Point[] };
export type RrfsEvidence = { status?: string; run_age_hours?: number; notice?: string; hours?: Hour[] };
export type ModelPriority = {
  policy?: string;
  setup_focus?: { band?: string; lead_model?: string | null; hours_ahead?: number; status?: string };
  bands?: Array<{ band: string; lead_model?: string | null; status?: string; from_hours: number; until_hours: number }>;
};

const fields = [
  ["temperature", "2 m temperature"], ["dew_point", "2 m dew point"],
  ["surface_cape", "Surface CAPE"], ["surface_cin", "Surface CIN"],
  ["srh_0_1km", "0–1 km SRH"], ["gust", "Surface gust"],
] as const;

const when = (value?: string) => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString() : "Unavailable";
};
const fieldValue = (row?: Field) => {
  if (!row || typeof row.value !== "number" || !Number.isFinite(row.value)) return "—";
  const unit = ({ "J kg**-1": "J/kg", "m**2 s**-2": "m²/s²", "m s**-1": "m/s" } as Record<string, string>)[row.unit ?? ""] ?? row.unit ?? "";
  return `${row.value.toFixed(1)} ${unit}`.trim();
};
const modelName = (value?: string | null) => value ? value.toUpperCase().replaceAll("_", " ") : "No current lead";

export function SetupRrfsEvidence({ rrfs, priority }: { rrfs?: RrfsEvidence; priority?: ModelPriority }) {
  const [pointIndex, setPointIndex] = useState(0);
  if (priority?.policy !== "horizon-v2") return null;
  const hours = rrfs?.hours ?? [];
  const points = hours[0]?.points ?? [];
  const chosen = pointIndex < points.length ? pointIndex : 0;
  return <section className="setup-rrfs" aria-label="RRFS forecast context">
    <header><div><h3>RRFS forecast context</h3><p>Operational 3 km CONUS guidance sampled at public screening areas</p></div>
      <span data-ready={rrfs?.status === "available"}>{rrfs?.status === "available" ? "AVAILABLE" : "UNAVAILABLE"}</span></header>
    <p className="setup-rrfs__lead">This setup: <strong>{modelName(priority.setup_focus?.lead_model)}</strong>
      {priority.setup_focus?.band ? ` · ${priority.setup_focus.band.replaceAll("_", " ")}` : ""}</p>
    <div className="setup-rrfs__bands" aria-label="Lead model by forecast range">{(priority.bands ?? []).map(band =>
      <span key={band.band}><b>{band.from_hours}–{band.until_hours} h</b> {modelName(band.lead_model)}</span>)}</div>
    {rrfs?.status === "available" && hours.length > 0 ? <>
      <div className="setup-rrfs__meta"><span>Run: {when(hours[0].run_time)}</span><span>{hours.length} sampled valid times</span>
        {typeof rrfs.run_age_hours === "number" && <span>Run age: {rrfs.run_age_hours.toFixed(1)} h</span>}</div>
      {points.length > 1 && <label className="setup-rrfs__select">Public sample area
        <select value={chosen} onChange={event => setPointIndex(Number(event.target.value))}>
          {points.map((point, index) => <option value={index} key={`${point.latitude}:${point.longitude}:${index}`}>
            {point.latitude.toFixed(3)}, {point.longitude.toFixed(3)}
          </option>)}</select></label>}
      {points.length === 1 && <p className="setup-rrfs__point">Public sample area: {points[0].latitude.toFixed(3)}, {points[0].longitude.toFixed(3)}</p>}
      <div className="setup-rrfs__scroll"><table><thead><tr><th scope="col">Valid (local)</th><th scope="col">Forecast hour</th>
        {fields.map(([, label]) => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>
        {hours.map((hour, index) => <tr key={`${hour.valid_time}:${index}`}><td>{when(hour.valid_time)}</td><td>{hour.forecast_hour ?? "—"}</td>
          {fields.map(([key]) => <td key={key}>{fieldValue(hour.points?.[chosen]?.fields?.[key])}</td>)}</tr>)}</tbody></table></div>
    </> : <p>Current RRFS sampled fields are unavailable for this revision.</p>}
    <p className="setup-rrfs__notice">RRFS is forecast context, not a tornado probability or chase target. Matching valid time, area, field and unit are required for model comparisons.</p>
  </section>;
}
