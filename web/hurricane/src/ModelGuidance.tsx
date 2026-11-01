import type { PublicHurricane } from "./types";
import { displayTime } from "./types";
import { positionAt, forecastBase, ageLabel } from "./forecastTime";

const independent = new Set(["HFAI","HFBI","AVNI","EMXI","CTCI","CMCI","NVGI","UKXI","HWFI","HMNI"]);
export default function ModelGuidance({data,selectedTime,onTimeChange}:{data:PublicHurricane;selectedTime:number;onTimeChange:(time:number)=>void}) {
  const base=forecastBase(data);
  const models=data.guidance.models.map(model=>({...model, point:positionAt(model.points,selectedTime)}));
  const valid=models.filter(m=>m.point?.wind_mph!=null);
  return <details className="models-section models-disclosure" id="models"><summary>Model guidance</summary><div className="section-heading"><div><p>Same valid time · {displayTime(new Date(selectedTime).toISOString())}</p></div><a href="https://www.nhc.noaa.gov/modelsummary.shtml" target="_blank" rel="noreferrer">NHC model guide ↗</a></div>
    <div className="model-toolbar"><div className="hour-selector" role="group" aria-label="Forecast valid time">{[6,12,24,48,72].map(hour=><button key={hour} type="button" aria-pressed={selectedTime===base+hour*3600_000} onClick={()=>onTimeChange(base+hour*3600_000)}>+{hour}h</button>)}</div><span>{data.projection.member_ids?.length ?? 0} contributors · {data.guidance.models.length} available aids</span></div>
    {valid.length>0 && <div className="intensity-comparison" aria-label="Forecast maximum wind by model">{valid.map(model=><div key={model.id}><span>{model.name}</span><i style={{width:`${Math.max(2,model.point!.wind_mph!/180*100)}%`}}/><strong>{model.point!.wind_mph} mph</strong></div>)}</div>}
    <details className="model-table-details"><summary>All model positions, cycles & shifts</summary><div className="model-table-wrap"><table><thead><tr><th>Model</th><th>Max wind</th><th>Center</th><th>Initialization</th><th>Role</th><th>48h shift</th></tr></thead><tbody>{models.map(model=><tr key={model.id}><th scope="row"><span className={`model-dot model-dot--${model.id}`}/>{model.name}</th><td>{model.point?.wind_mph==null ? "—" : `${model.point.wind_mph} mph`}</td><td>{model.point ? `${model.point.latitude.toFixed(1)}°, ${model.point.longitude.toFixed(1)}°` : "Outside run range"}</td><td>{displayTime(model.cycle)}<small className="cell-age">{ageLabel(model.cycle)}</small></td><td>{data.projection.member_ids?.includes(model.id) ? "Contributor" : independent.has(model.id) ? "Excluded / older" : "Comparison"}</td><td>{model.shift_48h_miles==null ? "—" : `${model.shift_48h_miles} mi`}</td></tr>)}</tbody></table></div></details>
    <p className="table-note">Positions and peak winds are interpolated to one valid time. No extrapolation. Track spread is model disagreement, not a probability cone. Winds describe the cyclone, not this address.</p>
  </details>;
}
