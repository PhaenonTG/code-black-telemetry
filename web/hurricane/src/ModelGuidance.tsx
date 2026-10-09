import { useState } from "react";
import type { Model, PublicHurricane } from "./types";
import { displayTime } from "./types";

const groups = [
  { label: "Dynamical models", ids: ["HFAI", "HFBI", "AVNI", "CTCI", "CMCI", "NVGI", "UKXI", "HWFI", "HMNI"] },
  { label: "Ensemble / consensus aids", ids: ["AEMI", "GDMI", "HCCA", "TVCN"] },
];

function Row({ model, hour }: { model: Model; hour: number }) {
  const point = model.points.find((item) => item.hour === hour);
  return <tr><th scope="row"><span className={`model-dot model-dot--${model.id}`}/>{model.name}</th>
    <td>{point?.wind_mph == null ? "—" : `${point.wind_mph} mph`}</td>
    <td>{point ? `${point.latitude.toFixed(1)}°, ${point.longitude.toFixed(1)}°` : "—"}</td>
    <td>{displayTime(model.cycle)}</td>
    <td>{model.shift_48h_miles == null ? "—" : `${model.shift_48h_miles} mi`}</td></tr>;
}

export default function ModelGuidance({ data }: { data: PublicHurricane }) {
  const [hour, setHour] = useState<24 | 48 | 72>(24);
  const byId = new Map(data.guidance.models.map((model) => [model.id, model]));
  return <section className="models-section" id="models">
    <div className="section-heading"><div><h2>Model guidance</h2><p>Guidance for storm centers and peak winds, not impacts at a location.</p></div><a href="https://www.nhc.noaa.gov/modelsummary.shtml" target="_blank" rel="noreferrer">NHC model guide ↗</a></div>
    <div className="model-toolbar"><div className="hour-selector" role="group" aria-label="Forecast hour">{([24, 48, 72] as const).map((value) => <button key={value} type="button" aria-pressed={hour === value} onClick={() => setHour(value)}>+{value}h</button>)}</div><span>{data.guidance.models.length} aids · latest cycle {displayTime(data.guidance.latest_cycle)}</span></div>
    <p className="model-scroll-hint">Swipe table for center positions, cycle times, and shifts →</p>
    <div className="model-table-wrap"><table><thead><tr><th>Model</th><th>Max wind</th><th>Center position</th><th>Cycle</th><th>48h shift*</th></tr></thead><tbody>{groups.flatMap((group) => [
      <tr className="group-row" key={`${group.label}-heading`}><th colSpan={5}>{group.label}</th></tr>,
      ...group.ids.map((id) => byId.get(id)).filter((model): model is Model => !!model).map((model) => <Row key={model.id} model={model} hour={hour}/>),
    ])}</tbody></table></div>
    <p className="table-note">Values are at the selected forecast hour from each model’s own cycle; cycles may differ. *Shift compares the same valid time with a prior cycle. Aegis’s experimental blend uses HAFS-A, HAFS-B, and GFS only; consensus aids are not averaged twice.</p>
  </section>;
}
