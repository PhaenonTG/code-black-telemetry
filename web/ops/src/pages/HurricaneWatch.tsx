import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Link } from "react-router-dom";
import { mapboxAccessToken } from "../../../../src/services/mapTiles";
import { fetchForecast } from "../core/client";
import { useCoreOps } from "../core/useCoreOps";
import "./HurricaneWatch.css";

type TrackPoint = { hour: number; latitude: number; longitude: number; wind_mph: number | null };
type Alert = { id?: string; event?: string; headline?: string; severity?: string; expires?: string; description?: string; url?: string };
type Report = { issued: string; office: string; text: string; url: string };
type HurricaneSnapshot = {
  status: "active" | "inactive" | "pending"; notice?: string; checked_at?: string; freshness?: "current" | "stale";
  storm?: { id: string; name: string; classification: string; intensity: string; pressure: string; latitudeNumeric: number; longitudeNumeric: number; movementDir: number; movementSpeed: number; lastUpdate: string; forecastGraphics?: { url: string }; publicAdvisory?: { url: string } };
  track?: TrackPoint[]; watch_point?: { label: string; latitude: number; longitude: number };
  assessment?: { updated_at: string; advisory: string; advisory_changed: boolean; intensity_mph: number; intensity_change_mph: number | null; center_distance_miles: number; forecast_point_distance_miles: number | null; closest_forecast_hour: number | null; summary: string; limitations: string };
  alerts?: Alert[]; alerts_status?: string; reports?: Report[]; reports_status?: string;
  ai?: { status: string; summary?: string; supporting_factors?: string; limiting_factors?: string; uncertainties?: string; recommended_attention?: string };
  history?: { checked_at?: string; advisory?: string; intensity_mph?: number; summary?: string }[];
};

const time = (value?: string) => value ? new Date(value).toLocaleString() : "Unavailable";
const line = (points: TrackPoint[]) => ({
  type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: points.map((point) => [point.longitude, point.latitude]) },
});

function HurricaneMap({ data }: { data: HurricaneSnapshot }) {
  const host = useRef<HTMLDivElement>(null);
  const token = mapboxAccessToken();
  useEffect(() => {
    if (!host.current || !data.storm || !data.watch_point || !data.track?.length || !token) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: host.current, style: "mapbox://styles/mapbox/dark-v11",
      center: [data.storm.longitudeNumeric, data.storm.latitudeNumeric], zoom: 4.6,
      attributionControl: false, interactive: true,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.addSource("nhc-track", { type: "geojson", data: line(data.track!) });
      map.addLayer({ id: "nhc-track-line", type: "line", source: "nhc-track",
        paint: { "line-color": "#ff6b58", "line-width": 3, "line-dasharray": [2, 1] } });
      for (const point of data.track!) {
        const marker = document.createElement("span");
        marker.className = "hurricane-watch__forecast-marker";
        marker.title = `NHC +${point.hour}h · ${point.wind_mph ?? "?"} mph`;
        new mapboxgl.Marker({ element: marker }).setLngLat([point.longitude, point.latitude])
          .setPopup(new mapboxgl.Popup({ offset: 12 }).setText(`NHC forecast +${point.hour}h · ${point.wind_mph ?? "unknown"} mph`))
          .addTo(map);
      }
      const watch = document.createElement("span");
      watch.className = "hurricane-watch__location-marker";
      watch.title = data.watch_point!.label;
      new mapboxgl.Marker({ element: watch }).setLngLat([data.watch_point!.longitude, data.watch_point!.latitude])
        .setPopup(new mapboxgl.Popup({ offset: 12 }).setText(data.watch_point!.label)).addTo(map);
      const bounds = new mapboxgl.LngLatBounds();
      data.track!.forEach((point) => bounds.extend([point.longitude, point.latitude]));
      bounds.extend([data.watch_point!.longitude, data.watch_point!.latitude]);
      map.fitBounds(bounds, { padding: 48, maxZoom: 6 });
    });
    return () => map.remove();
  }, [data, token]);
  if (!token && data.track?.length && data.watch_point) {
    const places = [...data.track, data.watch_point];
    const west = Math.min(...places.map((point) => point.longitude)) - 1.5;
    const east = Math.max(...places.map((point) => point.longitude)) + 1.5;
    const south = Math.min(...places.map((point) => point.latitude)) - 1;
    const north = Math.max(...places.map((point) => point.latitude)) + 1;
    const x = (longitude: number) => 35 + 530 * (longitude - west) / (east - west);
    const y = (latitude: number) => 305 - 270 * (latitude - south) / (north - south);
    return <svg className="hurricane-watch__map hurricane-watch__diagram" viewBox="0 0 600 340" role="img" aria-label="NHC forecast center positions and Grand Bay watch point">
      <rect width="600" height="340" fill="#0a1822" />
      {[1, 2, 3, 4].map((step) => <g key={step} stroke="#214052" strokeWidth="1"><line x1={step * 120} y1="0" x2={step * 120} y2="340" /><line x1="0" y1={step * 68} x2="600" y2={step * 68} /></g>)}
      <polyline fill="none" stroke="#ff6b58" strokeWidth="3" strokeDasharray="7 5" points={data.track.map((point) => `${x(point.longitude)},${y(point.latitude)}`).join(" ")} />
      {data.track.map((point) => <g key={point.hour}><circle cx={x(point.longitude)} cy={y(point.latitude)} r="6" fill="#ff6b58" stroke="white" strokeWidth="2" /><text x={x(point.longitude) + 10} y={y(point.latitude) - 9} fill="#fff" fontSize="12">+${point.hour}h · ${point.wind_mph ?? "?"} mph</text></g>)}
      <circle cx={x(data.watch_point.longitude)} cy={y(data.watch_point.latitude)} r="8" fill="#35d5ce" stroke="white" strokeWidth="3" />
      <text x={Math.min(460, x(data.watch_point.longitude) + 12)} y={y(data.watch_point.latitude) + 4} fill="#aefbf7" fontSize="13">Grand Bay watch</text>
      <text x="15" y="326" fill="#90a5b4" fontSize="11">NHC forecast points · schematic coordinate plot</text>
    </svg>;
  }
  return <div ref={host} className="hurricane-watch__map" role="img" aria-label="NHC forecast center points and Grand Bay watch location" />;
}

export default function HurricaneWatch() {
  const { config } = useCoreOps();
  const [data, setData] = useState<HurricaneSnapshot | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const next = await fetchForecast<HurricaneSnapshot>(config, "hurricane-watch");
        if (live) { setData(next); setError(""); }
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : "Hurricane watch is unavailable");
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => { live = false; window.clearInterval(timer); };
  }, [config]);
  const a = data?.assessment;
  return <main className="hurricane-watch">
    <header className="hurricane-watch__header"><div><span>AEGIS / HURRICANE WATCH</span><h1>{data?.storm ? `Hurricane ${data.storm.name}` : "Gulf hurricane watch"}</h1><p>Hourly official data assessment · Grand Bay, Alabama</p></div><Link to="/weather">Weather →</Link></header>
    {error && <p role="alert" className="hurricane-watch__error">{error}</p>}
    {!data && !error && <p role="status">Loading the latest assessment…</p>}
    {data?.status === "pending" && <p role="status">{data.notice}</p>}
    {data?.freshness === "stale" && <p role="alert" className="hurricane-watch__error">Hourly assessment is stale. Last successful update: {time(data.checked_at)}.</p>}
    {data?.status === "inactive" && <p className="hurricane-watch__error">NHC no longer lists this storm as active. The last assessment remains below.</p>}
    {data?.storm && a && <>
      <section className="hurricane-watch__metrics" aria-label="Official storm status">
        <div><small>MAX WIND · NHC</small><strong>{a.intensity_mph} mph</strong><span>{data.storm.classification} · {data.storm.pressure} mb</span></div>
        <div><small>CENTER → WATCH POINT</small><strong>{a.center_distance_miles} mi</strong><span>Current center distance</span></div>
        <div><small>CLOSEST FORECAST CENTER</small><strong>{a.forecast_point_distance_miles ?? "—"} mi</strong><span>{a.closest_forecast_hour != null ? `At NHC +${a.closest_forecast_hour}h point` : "Track unavailable"}</span></div>
      </section>
      <p className="hurricane-watch__stamp">NHC advisory {a.advisory} · issued {time(data.storm.lastUpdate)} · evaluated {time(a.updated_at)}</p>
      <HurricaneMap data={data} />
      <p className="hurricane-watch__caption">Dots are official NHC forecast center positions and wind estimates. The connecting line is for orientation only. Storm effects extend well beyond the center.</p>
      <section className="hurricane-watch__panel"><h2>Aegis assessment</h2><p>{a.summary}</p>
        {a.intensity_change_mph != null && <p>Wind change since the prior hourly assessment: {a.intensity_change_mph > 0 ? "+" : ""}{a.intensity_change_mph} mph.</p>}
        <p className="hurricane-watch__caution">{a.limitations}</p>
        {data.ai?.status === "ready" ? <div className="hurricane-watch__ai"><h3>AI findings</h3><p>{data.ai.summary}</p>{data.ai.supporting_factors && <p><b>Evidence:</b> {data.ai.supporting_factors}</p>}{data.ai.limiting_factors && <p><b>Limits:</b> {data.ai.limiting_factors}</p>}{data.ai.uncertainties && <p><b>Uncertainty:</b> {data.ai.uncertainties}</p>}</div>
          : <p className="hurricane-watch__caution">AI commentary unavailable for this cycle; the official source assessment is current.</p>}
      </section>
      <section className="hurricane-watch__panel"><h2>Grand Bay warning watch</h2><p>{data.watch_point?.label} · {data.alerts_status === "ready" ? `${data.alerts?.length ?? 0} active NWS alerts` : "NWS alerts unavailable"}</p>
        {data.alerts?.map((alert) => <details key={alert.id}><summary>{alert.event} · {alert.severity}</summary><p>{alert.headline}</p><p>{alert.description}</p><small>Expires {time(alert.expires)}</small>{alert.url && <p><a href={alert.url} target="_blank" rel="noreferrer">Official warning ↗</a></p>}</details>)}
      </section>
      <section className="hurricane-watch__panel"><h2>Preliminary storm reports</h2><p>Mobile NWS office · last 36 hours · {data.reports_status === "ready" ? `${data.reports?.length ?? 0} products` : "Feed unavailable"}</p>
        {data.reports?.map((report) => <details key={report.url}><summary>{time(report.issued)} · {report.office}</summary><pre>{report.text}</pre><a href={report.url} target="_blank" rel="noreferrer">Official report ↗</a></details>)}
      </section>
      <details className="hurricane-watch__panel"><summary>Hourly assessment history</summary>{data.history?.map((item, index) => <p key={item.checked_at ?? index}><b>{time(item.checked_at)}</b> · advisory {item.advisory} · {item.intensity_mph} mph<br />{item.summary}</p>)}</details>
      <p className="hurricane-watch__sources"><a href={data.storm.publicAdvisory?.url} target="_blank" rel="noreferrer">NHC advisory ↗</a><a href={data.storm.forecastGraphics?.url} target="_blank" rel="noreferrer">NHC forecast graphics ↗</a></p>
    </>}
  </main>;
}
