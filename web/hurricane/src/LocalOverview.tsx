import { useEffect, useState } from "react";
import type { PointAlert, WatchLocation } from "./watchLocation";
import type { PublicHurricane } from "./types";
import { displayTime } from "./types";
import { ageLabel } from "./forecastTime";

type Period = { startTime: string; endTime: string; temperature: number; temperatureUnit: string; windSpeed: string; windDirection: string; shortForecast: string; probabilityOfPrecipitation?: { value: number | null } };
export type LocalForecast = { periods: Period[]; updated: string | null; status: "loading" | "ready" | "unavailable" };
export function useLocalForecast(watch: WatchLocation): LocalForecast {
  const [result,setResult] = useState<LocalForecast>({periods:[],updated:null,status:"loading"});
  useEffect(()=>{
    const controller = new AbortController(); let busy = false;
    setResult({periods:[],updated:null,status:"loading"});
    const load = async()=>{ if(busy) return; busy=true; try {
      const pointResponse = await fetch(`https://api.weather.gov/points/${watch.latitude.toFixed(4)},${watch.longitude.toFixed(4)}`,{signal:controller.signal});
      if(!pointResponse.ok) throw new Error();
      const point = await pointResponse.json(); const url = new URL(point.properties.forecastHourly);
      if(url.origin !== "https://api.weather.gov") throw new Error();
      const response = await fetch(url,{signal:controller.signal}); if(!response.ok) throw new Error();
      const body = await response.json();
      if(!controller.signal.aborted) setResult({periods:body.properties.periods ?? [], updated:body.properties.updateTime ?? body.properties.generatedAt ?? null,status:"ready"});
    }catch{if(!controller.signal.aborted) setResult(current=>({...current,status:"unavailable"}));}finally{busy=false;} };
    void load(); const timer=window.setInterval(()=>void load(),300_000);
    return ()=>{controller.abort();clearInterval(timer);};
  },[watch.latitude,watch.longitude]);
  return result;
}

export function localNarrative(watch: WatchLocation, alerts: PointAlert[], status: string, forecast: LocalForecast) {
  const warning = alerts.find(a=>/Tornado Warning/i.test(a.event)) ?? alerts.find(a=>/Warning/i.test(a.event));
  const current = forecast.periods.find(p=>Date.parse(p.endTime)>Date.now());
  return `${watch.label}: ${status !== "ready" ? "local alert check pending or unavailable" : warning ? `${warning.event} in effect` : alerts.length ? alerts.map(a=>a.event).slice(0,2).join("; ") : "no active NWS alert returned"}.${current ? ` NWS hourly forecast: ${current.shortForecast}; wind ${current.windDirection} ${current.windSpeed}.` : ""}`;
}

function hazardText(alert: PointAlert) {
  const lines=alert.description?.split("\n") ?? [];
  return lines.flatMap((line,i)=>{
    if(!/window for|peak wind forecast|potential rainfall|potential surge/i.test(line))return [];
    let text=line.trim();
    for(let j=i+1;j<Math.min(lines.length,i+5);j++){
      const part=lines[j].trim();if(!part || /^[-*]/.test(part) || /^[A-Z /]+:/.test(part))break;text+=" "+part;
    }
    return [{event:alert.event,text}];
  }).slice(0,3);
}

export default function LocalOverview({data,watch,alerts,status,forecast,now}:{data:PublicHurricane;watch:WatchLocation;alerts:PointAlert[];status:string;forecast:LocalForecast;now:number}) {
  const headline=alerts.find(a=>/Tornado Warning/i.test(a.event)) ?? alerts.find(a=>/Hurricane Warning/i.test(a.event)) ?? alerts.find(a=>/Warning/i.test(a.event));
  const rows=forecast.periods.filter(p=>Date.parse(p.endTime)>now).slice(0,24);
  const windows=alerts.flatMap(hazardText);
  return <section className="local-overview" id="overview"><div className="local-overview__head"><div><span className="eyebrow">YOUR LOCAL OUTLOOK</span><h2>{watch.label}</h2></div><a href="#watch">Change location ↗</a></div>
    <div className={`local-priority ${headline ? "local-priority--warning" : ""}`}><strong>{status !== "ready" ? "Checking local warnings" : headline?.event ?? (alerts.length ? "Weather alerts in effect" : "No active alert returned")}</strong><a href="#alerts">{alerts.length ? `${alerts.length} alerts · Details ↓` : "NWS details ↓"}</a></div>
    <p className="local-lead">{localNarrative(watch,alerts,status,forecast)}</p>
    <div className="hazard-windows">{windows.slice(0,3).map((w,i)=><p key={i}><span>{w.event}</span>{w.text.replace(/^[-*]\s*/,"")}</p>)}{data.regional_alerts.some(a=>a.event==="Storm Surge Warning") && <p><span>Nearby coastal zone</span>Storm Surge Warning · <a href={data.regional_alerts.find(a=>a.event==="Storm Surge Warning")?.url ?? "https://www.weather.gov/mob/"} target="_blank" rel="noreferrer">Coastal details ↗</a></p>}</div>
    <details className="local-hourly" data-status={forecast.status}><summary>Next 24 hours · NWS point forecast <span>{forecast.status==="ready" ? ageLabel(forecast.updated,now) : forecast.status==="loading" ? "Loading" : "Unavailable"}</span></summary>
      {rows.length ? <><div className="hourly-strip">{rows.map(p=><div key={p.startTime}><strong>{new Date(p.startTime).toLocaleTimeString("en-US",{hour:"numeric"})}</strong><b>{p.windSpeed}</b><span>{p.windDirection} wind</span><b>{p.probabilityOfPrecipitation?.value == null ? "—" : `${p.probabilityOfPrecipitation.value}%`}</b><span>Precipitation</span><small>{p.shortForecast}</small></div>)}</div><small>Forecast issued {displayTime(forecast.updated)} · Wind is sustained, not gusts.</small></> : <p>NWS hourly forecast is unavailable for this point. <a href={`https://forecast.weather.gov/MapClick.php?lat=${watch.latitude}&lon=${watch.longitude}`} target="_blank" rel="noreferrer">Open local forecast ↗</a></p>}
    </details>
  </section>;
}
