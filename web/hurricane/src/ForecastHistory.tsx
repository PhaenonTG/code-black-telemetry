import { useEffect, useState } from "react";
import type { PublicHurricane } from "./types";
import { displayTime } from "./types";
import { ageLabel } from "./forecastTime";

export function SinceVisit({data}:{data:PublicHurricane}) {
  const [prior]=useState(()=>{try{return JSON.parse(localStorage.getItem("tropics-last-visit") ?? "null")}catch{return null}});
  useEffect(()=>{try{localStorage.setItem("tropics-last-visit",JSON.stringify({storm:data.storm.id,at:data.checked_at,wind:data.storm.max_wind_mph,pressure:data.storm.pressure_mb,cycle:data.guidance.latest_cycle}));}catch{}},[data]);
  if(!prior || prior.storm!==data.storm.id || prior.at===data.checked_at) return null;
  const changes=[];
  if(prior.wind!=null && data.storm.max_wind_mph!=null && data.storm.max_wind_mph!==prior.wind) changes.push(`Wind ${data.storm.max_wind_mph-prior.wind>0 ? "+" : ""}${data.storm.max_wind_mph-prior.wind} mph`);
  if(prior.pressure!=null && data.storm.pressure_mb!=null && data.storm.pressure_mb!==prior.pressure) changes.push(`Pressure ${data.storm.pressure_mb-prior.pressure>0 ? "+" : ""}${data.storm.pressure_mb-prior.pressure} mb`);
  if(prior.cycle!==data.guidance.latest_cycle) changes.push("New model cycle");
  return changes.length ? <div className="since-visit"><span>Since your last visit</span><strong>{changes.join(" · ")}</strong><small>{displayTime(prior.at)}</small></div> : null;
}

export default function ForecastHistory({data}:{data:PublicHurricane}) {
  const samples=data.verification?.samples ?? [];
  const scores=data.verification?.scorecard ?? [];
  const matched=scores.reduce((count,row)=>count+row.matched_count,0);
  return <section className="forecast-audit" id="verification"><details><summary>Forecast history & verification <span>{matched ? `${matched} matched center forecasts` : "Collecting observations"}</span></summary>
    <p>Mean center error against preliminary NHC best-track positions. Each row compares forecasts captured in the same hour and verified at the same time. Model cycle ages can differ; small samples are not a skill ranking.</p>
    <div className="audit-scorecard" role="table" aria-label="Matched forecast center errors"><div className="audit-scorecard__row" role="row"><b role="columnheader">Lead</b><b role="columnheader">Code Black</b><b role="columnheader">NHC</b><b role="columnheader">Pairs</b></div>{scores.map(row=><div className="audit-scorecard__row" role="row" key={row.lead}><span role="cell">{row.lead}</span><strong role="cell">{row.code_black_mean_miles == null ? "—" : `${row.code_black_mean_miles} mi`}</strong><strong role="cell">{row.nhc_mean_miles == null ? "—" : `${row.nhc_mean_miles} mi`}</strong><span role="cell">{row.matched_count}</span></div>)}</div>
    {!matched && <p>Awaiting matched forecast and observation times. No extrapolated scores are shown.</p>}
    <p>{samples.length} archived forecast samples retained. Preliminary observations can be revised.</p>
    <div className="audit-history">{data.verification?.history.map(h=><p key={h.cycle}><b>{displayTime(h.cycle)}</b><span>{h.points.length} archived positions · {ageLabel(h.checked_at)}</span></p>)}</div>
  </details></section>;
}
