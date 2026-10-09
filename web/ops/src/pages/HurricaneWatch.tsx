import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Link } from "react-router-dom";
import { startAtlasMosaicLayer, type MosaicStatus } from "../../../../src/map/AtlasMosaicLayer";
import { mapboxAccessToken } from "../../../../src/services/mapTiles";
import { fetchForecast } from "../core/client";
import { useCoreOps } from "../core/useCoreOps";
import { createHurricaneBriefingImage } from "./hurricaneBriefingImage";
import "./HurricaneWatch.css";

type TrackPoint = { hour: number; latitude: number; longitude: number; wind_mph: number | null };
type ModelPoint = TrackPoint & { valid_time: string; pressure_mb: number | null };
type ModelRun = { id: string; name: string; cycle: string; previous_cycle: string | null; points: ModelPoint[]; previous_points: ModelPoint[]; shift_48h_miles: number | null; closest_center_miles: number; closest_hour: number };
type ModelGuidance = { status: string; latest_cycle?: string; comparison_valid_time?: string; spread_48h_miles?: number | null; wind_48h_mph_range?: number[] | null; models: ModelRun[]; caution?: string; notice?: string };
type ObservedPoint = { valid_time: string; latitude: number; longitude: number; wind_mph: number | null; pressure_mb: number | null };
type Alert = { id?: string; event?: string; headline?: string; severity?: string; expires?: string; description?: string; url?: string };
type Report = { issued: string; office: string; text: string; url: string };
type HurricaneSnapshot = {
  status: "active" | "inactive" | "pending"; notice?: string; checked_at?: string; freshness?: "current" | "stale";
  storm?: { id: string; name: string; classification: string; intensity: string; pressure: string; latitudeNumeric: number; longitudeNumeric: number; movementDir: number; movementSpeed: number; lastUpdate: string; forecastTrack?: { issuance: string }; forecastGraphics?: { url: string }; publicAdvisory?: { url: string }; forecastDiscussion?: { url: string } };
  track?: TrackPoint[]; cone?: number[][]; cone_status?: string; observed_track?: ObservedPoint[]; observed_status?: string;
  model_guidance?: ModelGuidance;
  watch_point?: { label: string; latitude: number; longitude: number };
  observed_trend?: { period_hours: number | null; wind_change_mph: number | null; pressure_change_mb: number | null; baseline_time?: string };
  assessment?: { updated_at: string; advisory: string; advisory_changed: boolean; intensity_mph: number; intensity_change_mph: number | null; center_distance_miles: number; forecast_point_distance_miles: number | null; closest_forecast_hour: number | null; summary: string; limitations: string };
  alerts?: Alert[]; alerts_status?: string; alerts_checked_at?: string; rapid_alerts_status?: string; rapid_alerts_checked_at?: string; reports?: Report[]; reports_status?: string;
  coastal_context_alerts?: Alert[]; coastal_context_status?: string; coastal_context_zone?: string;
  ai?: { status: string; analyzed_at?: string; reused?: boolean; summary?: string; supporting_factors?: string | string[]; limiting_factors?: string | string[]; uncertainties?: string | string[]; recommended_attention?: string | string[] };
  changes_since_previous?: { advisory_changed?: boolean; wind_change_mph?: number | null; pressure_change_mb?: number | null; new_alerts?: string[]; cleared_alerts?: string[]; new_reports?: string[]; model_cycle_changes?: string[] };
  history?: { checked_at?: string; advisory?: string; intensity_mph?: number; summary?: string }[];
};

const time = (value?: string) => value ? new Date(value).toLocaleString() : "Unavailable";
const shortTime = (value?: string) => value ? new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" }) : "—";
const signed = (value: number | null | undefined, suffix: string) => value == null ? "Not available" : `${value > 0 ? "+" : ""}${value} ${suffix}`;
const narrative = (value?: string | string[]) => Array.isArray(value) ? value.join("; ") : value;
const modelColors: Record<string, string> = { HFAI: "#f6bf64", HFBI: "#be9df7", AVNI: "#82aeff", CTCI: "#fa9372", CMCI: "#6db6ff", NVGI: "#9bbdd9", UKXI: "#f5cf75", AEMI: "#8bcfa5", GDMI: "#b5da7c", HWFI: "#f18cbb", HMNI: "#c48de8", HCCA: "#c5d4e1", TVCN: "#91dcaa" };
const rapidEvents = new Set(["Tornado Warning", "Severe Thunderstorm Warning", "Tornado Watch", "Severe Thunderstorm Watch"]);
const line = (points: { latitude: number; longitude: number }[]) => ({
  type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: points.map((point) => [point.longitude, point.latitude]) },
});

function HurricaneMap({ data, registerCapture, onRadarStatus, onRadarVisible, printMap }: { data: HurricaneSnapshot; registerCapture: (capture: (() => string | null) | null) => void; onRadarStatus: (status: MosaicStatus) => void; onRadarVisible: (visible: boolean) => void; printMap: string | null }) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<InstanceType<typeof mapboxgl.Map> | null>(null);
  const visible = useRef(true);
  const [radarOn, setRadarOn] = useState(true);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [showPrior, setShowPrior] = useState(false);
  const [radarStatus, setRadarStatus] = useState<MosaicStatus>("loading");
  const token = mapboxAccessToken();
  const models = useMemo(() => data.model_guidance?.models ?? [], [data.model_guidance]);
  const mapKey = JSON.stringify([data.storm?.id, data.assessment?.advisory, data.track, data.cone, data.observed_track, data.watch_point, data.model_guidance]);
  useEffect(() => { visible.current = radarOn; onRadarVisible(radarOn); }, [radarOn, onRadarVisible]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const model of models) {
      for (const prior of [false, true]) {
        const id = `model-${model.id}${prior ? "-prior" : ""}`;
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", selectedModels.includes(model.id) && (!prior || showPrior) ? "visible" : "none");
      }
    }
  }, [selectedModels, showPrior, mapKey, models]);
  useEffect(() => {
    if (!host.current || !data.storm || !data.watch_point || !data.track?.length || !token) return;
    setRadarStatus("loading");
    onRadarStatus("loading");
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: host.current, style: "mapbox://styles/mapbox/dark-v11", preserveDrawingBuffer: true,
      center: [data.storm.longitudeNumeric, data.storm.latitudeNumeric], zoom: 4.6,
      attributionControl: false, interactive: true,
    });
    mapRef.current = map;
    registerCapture(() => {
      try { return map.getCanvas().toDataURL("image/png"); }
      catch { return null; }
    });
    let stopRadar: (() => void) | undefined;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      stopRadar = startAtlasMosaicLayer(map as unknown as Parameters<typeof startAtlasMosaicLayer>[0], () => visible.current, undefined, (status) => { setRadarStatus(status); onRadarStatus(status); });
      if (data.cone && data.cone.length >= 4) {
        map.addSource("nhc-cone", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [data.cone] } } });
        map.addLayer({ id: "nhc-cone-fill", type: "fill", source: "nhc-cone", paint: { "fill-color": "#d5e4ee", "fill-opacity": 0.13 } });
        map.addLayer({ id: "nhc-cone-edge", type: "line", source: "nhc-cone", paint: { "line-color": "#c5dbe8", "line-opacity": 0.7, "line-width": 1.5 } });
      }
      if (data.observed_track && data.observed_track.length > 1) {
        map.addSource("nhc-observed", { type: "geojson", data: line(data.observed_track) });
        map.addLayer({ id: "nhc-observed-line", type: "line", source: "nhc-observed", paint: { "line-color": "#56d5cf", "line-width": 3 } });
      }
      map.addSource("nhc-track", { type: "geojson", data: line(data.track!) });
      map.addLayer({ id: "nhc-track-line", type: "line", source: "nhc-track",
        paint: { "line-color": "#ff6b58", "line-width": 3, "line-dasharray": [2, 1] } });
      for (const model of data.model_guidance?.models ?? []) {
        for (const prior of [false, true]) {
          const points = prior ? model.previous_points : model.points;
          if (points.length < 2) continue;
          const id = `model-${model.id}${prior ? "-prior" : ""}`;
          map.addSource(id, { type: "geojson", data: line(points) });
          map.addLayer({ id, type: "line", source: id,
            layout: { visibility: selectedModels.includes(model.id) && (!prior || showPrior) ? "visible" : "none" },
            paint: { "line-color": modelColors[model.id] ?? "#aaa", "line-width": prior ? 1.5 : 2.5,
              "line-opacity": prior ? 0.5 : 0.9, "line-dasharray": prior ? [2, 3] : [1, 0] } });
        }
      }
      map.addSource("nhc-forecast-points", { type: "geojson", data: { type: "FeatureCollection", features: data.track!.map((point) => ({ type: "Feature", properties: { hour: point.hour }, geometry: { type: "Point", coordinates: [point.longitude, point.latitude] } })) } });
      map.addLayer({ id: "nhc-forecast-dots", type: "circle", source: "nhc-forecast-points", paint: { "circle-radius": 6, "circle-color": "#ff715f", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
      map.addSource("nhc-watch-point", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [data.watch_point!.longitude, data.watch_point!.latitude] } } });
      map.addLayer({ id: "nhc-watch-dot", type: "circle", source: "nhc-watch-point", paint: { "circle-radius": 9, "circle-color": "#35d5ce", "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 } });
      map.addLayer({ id: "nhc-watch-label", type: "symbol", source: "nhc-watch-point", layout: { "text-field": "Grand Bay watch", "text-size": 12, "text-offset": [0, 1.5], "text-anchor": "top" }, paint: { "text-color": "#d7fffa", "text-halo-color": "#10202a", "text-halo-width": 2 } });
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
    return () => { registerCapture(null); stopRadar?.(); mapRef.current = null; map.remove(); };
  // Minute-by-minute warning polling must not reset the map camera.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapKey, token]);
  if (!token && data.track?.length && data.watch_point) {
    const places = [...data.track, ...(data.observed_track ?? []), data.watch_point];
    const west = Math.min(...places.map((point) => point.longitude)) - 1.5;
    const east = Math.max(...places.map((point) => point.longitude)) + 1.5;
    const south = Math.min(...places.map((point) => point.latitude)) - 1;
    const north = Math.max(...places.map((point) => point.latitude)) + 1;
    const x = (longitude: number) => 35 + 530 * (longitude - west) / (east - west);
    const y = (latitude: number) => 305 - 270 * (latitude - south) / (north - south);
    return <svg className="hurricane-watch__map hurricane-watch__diagram" viewBox="0 0 600 340" role="img" aria-label="Schematic forecast positions; live radar is unavailable without a map token">
      <rect width="600" height="340" fill="#0a1822" />
      {[1, 2, 3, 4].map((step) => <g key={step} stroke="#214052" strokeWidth="1"><line x1={step * 120} y1="0" x2={step * 120} y2="340" /><line x1="0" y1={step * 68} x2="600" y2={step * 68} /></g>)}
      {data.cone && <polygon points={data.cone.map(([lon, lat]) => `${x(lon)},${y(lat)}`).join(" ")} fill="#d5e4ee" fillOpacity=".13" stroke="#a8c7d8" />}
      {data.observed_track && <polyline fill="none" stroke="#56d5cf" strokeWidth="3" points={data.observed_track.map((point) => `${x(point.longitude)},${y(point.latitude)}`).join(" ")} />}
      <polyline fill="none" stroke="#ff6b58" strokeWidth="3" strokeDasharray="7 5" points={data.track.map((point) => `${x(point.longitude)},${y(point.latitude)}`).join(" ")} />
      {data.track.map((point) => <g key={point.hour}><circle cx={x(point.longitude)} cy={y(point.latitude)} r="6" fill="#ff6b58" stroke="white" strokeWidth="2" /><text x={x(point.longitude) + 10} y={y(point.latitude) - 9} fill="#fff" fontSize="12">+${point.hour}h · ${point.wind_mph ?? "?"} mph</text></g>)}
      <circle cx={x(data.watch_point.longitude)} cy={y(data.watch_point.latitude)} r="8" fill="#35d5ce" stroke="white" strokeWidth="3" />
      <text x={Math.min(460, x(data.watch_point.longitude) + 12)} y={y(data.watch_point.latitude) + 4} fill="#aefbf7" fontSize="13">Grand Bay watch</text>
      <text x="15" y="326" fill="#90a5b4" fontSize="11">Schematic only · live radar unavailable</text>
    </svg>;
  }
  return <div className="hurricane-watch__map-wrap"><div ref={host} className="hurricane-watch__map" role="img" aria-label="Current IEM NEXRAD radar mosaic, NHC cone, observed and forecast track, and Grand Bay watch location" />
    {printMap && <img className="hurricane-watch__print-map" src={printMap} alt="Captured radar map for this briefing" />}
    <div className="hurricane-watch__radar"><span className={`hurricane-watch__radar-dot hurricane-watch__radar-dot--${radarStatus}`} /> Radar {radarOn ? radarStatus : "off"}<button type="button" aria-pressed={radarOn} onClick={() => setRadarOn((on) => !on)}>{radarOn ? "Hide" : "Show"}</button></div>
    <div className="hurricane-watch__legend"><span><i className="hurricane-watch__legend-observed" />Observed</span><span><i className="hurricane-watch__legend-forecast" />NHC forecast</span><span><i className="hurricane-watch__legend-watch" />Watch point</span></div>
    {models.length > 0 && <div className="hurricane-watch__model-toggles" aria-label="Optional model track overlays"><strong>Model overlays</strong>{models.map((model) => <button key={model.id} type="button" aria-pressed={selectedModels.includes(model.id)} onClick={() => setSelectedModels((ids) => ids.includes(model.id) ? ids.filter((id) => id !== model.id) : [...ids, model.id])} style={{ "--model-color": modelColors[model.id] ?? "#aaa" } as React.CSSProperties}>{model.name}</button>)}<button type="button" aria-pressed={showPrior} onClick={() => setShowPrior((value) => !value)}>Prior runs</button></div>}
  </div>;
}

function Trend({ data }: { data: HurricaneSnapshot }) {
  const observed = (data.observed_track ?? []).filter((point) => point.wind_mph != null);
  const forecast = (data.track ?? []).filter((point) => point.wind_mph != null);
  if (!observed.length && !forecast.length) return <p>Trend data is unavailable.</p>;
  const issuance = new Date(data.storm?.forecastTrack?.issuance ?? data.storm?.lastUpdate ?? data.checked_at ?? "1970-01-01T00:00:00Z").getTime();
  const values = [...observed.map((point) => ({ x: new Date(point.valid_time).getTime(), y: point.wind_mph! })),
    ...forecast.map((point) => ({ x: issuance + point.hour * 3_600_000, y: point.wind_mph! }))];
  const minX = Math.min(...values.map((point) => point.x));
  const maxX = Math.max(...values.map((point) => point.x));
  const minY = Math.max(0, Math.floor(Math.min(...values.map((point) => point.y)) / 20) * 20 - 20);
  const maxY = Math.ceil(Math.max(...values.map((point) => point.y)) / 20) * 20 + 20;
  const x = (value: number) => 42 + (value - minX) / Math.max(maxX - minX, 1) * 690;
  const y = (value: number) => 190 - (value - minY) / Math.max(maxY - minY, 1) * 150;
  return <><div className="hurricane-watch__trend-stats"><div><small>WIND CHANGE · NHC BEST TRACK</small><strong>{signed(data.observed_trend?.wind_change_mph, "mph")}</strong><span>over {data.observed_trend?.period_hours ?? "—"} hours</span></div><div><small>PRESSURE CHANGE</small><strong>{signed(data.observed_trend?.pressure_change_mb, "mb")}</strong><span>Falling pressure can indicate strengthening</span></div></div>
    <svg className="hurricane-watch__chart" viewBox="0 0 780 235" role="img" aria-label="Observed NHC wind history and published forecast wind by time">
      {[0, 1, 2, 3].map((step) => { const wind = minY + (maxY - minY) * step / 3; return <g key={step}><line x1="42" x2="732" y1={y(wind)} y2={y(wind)} stroke="#303944" /><text x="2" y={y(wind) + 4} fill="#8d9aa8" fontSize="12">{Math.round(wind)}</text></g>; })}
      <line x1={x(issuance)} x2={x(issuance)} y1="30" y2="190" stroke="#8795a3" strokeDasharray="3 5" />
      {observed.length > 0 && <polyline points={observed.map((point) => `${x(new Date(point.valid_time).getTime())},${y(point.wind_mph!)}`).join(" ")} fill="none" stroke="#56d5cf" strokeWidth="3" strokeLinejoin="round" />}
      {forecast.length > 0 && <polyline points={forecast.map((point) => `${x(issuance + point.hour * 3_600_000)},${y(point.wind_mph!)}`).join(" ")} fill="none" stroke="#ff715f" strokeWidth="3" strokeDasharray="7 5" strokeLinejoin="round" />}
      <text x="42" y="220" fill="#aeb7c1" fontSize="12">{shortTime(new Date(minX).toISOString())}</text><text x={Math.max(42, Math.min(650, x(issuance) - 35))} y="19" fill="#aeb7c1" fontSize="12">Advisory</text><text x="660" y="220" fill="#aeb7c1" fontSize="12">{shortTime(new Date(maxX).toISOString())}</text>
    </svg><p className="hurricane-watch__chart-caption"><span className="hurricane-watch__key-observed">Observed · preliminary NHC best track</span><span className="hurricane-watch__key-forecast">Forecast · NHC advisory</span></p>
    <p className="hurricane-watch__caution">The solid line is preliminary history. The dashed line is the official forecast, not a measured trend or an Aegis prediction. Both may change with new advisories.</p></>;
}

function Guidance({ guidance, checkedAt }: { guidance?: ModelGuidance; checkedAt?: string }) {
  if (!guidance || guidance.status !== "ready" || !guidance.models.length) return <section className="hurricane-watch__panel"><h2>Model guidance</h2><p className="hurricane-watch__caution">{guidance?.notice ?? "Model guidance is not available yet. The official NHC forecast remains available above."}</p></section>;
  const newest = new Date(guidance.latest_cycle ?? "").getTime();
  const stale = Number.isFinite(newest) && checkedAt != null && new Date(checkedAt).getTime() - newest > 12 * 3_600_000;
  return <section className="hurricane-watch__panel hurricane-watch__guidance"><div className="hurricane-watch__guidance-head"><div><h2>Model guidance</h2><p>Latest available cycles · optional map overlays above</p></div><span>{stale ? "OLDER GUIDANCE" : "SECONDARY GUIDANCE"}</span></div>
    <p className="hurricane-watch__caution">These are independent model tracks, not additional NHC forecast paths. Cycles can arrive at different times. “Closest center” is not a wind, surge, rain, or tornado-risk estimate.</p>
    {guidance.spread_48h_miles != null && <div className="hurricane-watch__guidance-comparison"><div><small>48h TRACK SPREAD</small><strong>{guidance.spread_48h_miles} mi</strong><span>Farthest separation among HAFS-A, HAFS-B, and GFS centers</span></div><div><small>48h MAX-WIND GUIDANCE</small><strong>{guidance.wind_48h_mph_range ? `${guidance.wind_48h_mph_range[0]}–${guidance.wind_48h_mph_range[1]} mph` : "Unavailable"}</strong><span>Same valid time · {time(guidance.comparison_valid_time)}</span></div></div>}
    <div className="hurricane-watch__guidance-grid">{guidance.models.map((model) => <article key={model.id} style={{ "--model-color": modelColors[model.id] ?? "#aaa" } as React.CSSProperties}>
      <div className="hurricane-watch__guidance-title"><i /><strong>{model.name}</strong><small>{time(model.cycle)}</small></div>
      <div className="hurricane-watch__guidance-values"><div><span>Closest plotted center to Grand Bay</span><b>{model.closest_center_miles} mi <small>at +{model.closest_hour}h</small></b></div><div><span>48h position shift vs prior run</span><b>{model.shift_48h_miles == null ? "Not comparable" : `${model.shift_48h_miles} mi`}</b></div></div>
      {model.previous_cycle && <small className="hurricane-watch__guidance-prior">Prior cycle: {time(model.previous_cycle)} · comparison uses the same forecast-valid time</small>}
    </article>)}</div>
    <p className="hurricane-watch__caution">A larger shift means lower run-to-run track stability at that time, not a measured change in storm motion. Use the NHC advisory and local NWS warnings for decisions.</p>
    <a href="https://ftp.nhc.noaa.gov/atcf/aid_public/" target="_blank" rel="noreferrer">NHC public model-aid archive ↗</a>
  </section>;
}

function shareText(data: HurricaneSnapshot) {
  const a = data.assessment!;
  const active = data.alerts_status === "ready" ? `${data.alerts?.length ?? 0} active NWS alert(s) at Grand Bay` : "NWS alert status unavailable";
  const warnings = data.alerts_status === "ready" ? (data.alerts ?? []).slice(0, 4).map((alert) => `• ${alert.event ?? "Warning"}: ${alert.headline ?? "See official NWS alert"} (expires ${time(alert.expires)})`).join("\n") : "";
  const trend = data.observed_trend?.wind_change_mph == null ? "Observed trend unavailable" : `Observed wind change: ${signed(data.observed_trend.wind_change_mph, "mph")} over ${data.observed_trend.period_hours}h`;
  const aiRead = data.ai?.status === "ready" && data.ai.summary ? `\nAegis interpretation (not official): ${data.ai.summary}` : "";
  const models = data.model_guidance?.status === "ready" ? `\nModel guidance (secondary; latest ${time(data.model_guidance.latest_cycle)}): ${data.model_guidance.models.map((model) => `${model.name} ${time(model.cycle)} · closest plotted center ${model.closest_center_miles} mi`).join("; ")}` : "";
  return `${data.storm!.name} · Grand Bay family watch\nNHC advisory ${a.advisory} · ${time(data.storm?.lastUpdate)}\nMax wind ${a.intensity_mph} mph · ${data.storm!.pressure} mb · center ${a.center_distance_miles} mi from watch point\n${trend}\n${active}${warnings ? `\n${warnings}` : ""}\n${a.summary}${models}${aiRead}\nOfficial advisory: ${data.storm?.publicAdvisory?.url ?? "https://www.nhc.noaa.gov/"}\nOPS map: ${window.location.origin}/hurricane\nForecasts change. Follow NHC/NWS warnings and local emergency officials.`;
}

export default function HurricaneWatch() {
  const { config } = useCoreOps();
  const [data, setData] = useState<HurricaneSnapshot | null>(null);
  const [error, setError] = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const [imageStatus, setImageStatus] = useState("");
  const [generatingImage, setGeneratingImage] = useState(false);
  const [exportRadarStatus, setExportRadarStatus] = useState<MosaicStatus>("loading");
  const [radarVisible, setRadarVisible] = useState(true);
  const [briefingImage, setBriefingImage] = useState<{ url: string; blob: Blob } | null>(null);
  const imageUrl = useRef<string | null>(null);
  const [printMap, setPrintMap] = useState<string | null>(null);
  const captureMap = useRef<(() => string | null) | null>(null);
  useEffect(() => () => { if (imageUrl.current) URL.revokeObjectURL(imageUrl.current); }, []);
  useEffect(() => {
    if (!briefingImage) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") closeImage(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  // closeImage only revokes the current URL; this listener is scoped to the open preview.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briefingImage]);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const next = await fetchForecast<HurricaneSnapshot>(config, "hurricane-watch");
        if (next.watch_point) {
          const params = new URLSearchParams({ latitude: String(next.watch_point.latitude), longitude: String(next.watch_point.longitude) });
          try {
            const warnings = await fetchForecast<{ status: string; alerts: Alert[]; queried_at?: string }>(config, `alerts?${params}`);
            next.rapid_alerts_status = warnings.status;
            next.rapid_alerts_checked_at = warnings.queried_at;
            if (warnings.status === "ready") {
              // The rapid endpoint intentionally contains only convective alerts.
              // Preserve all other NWS hazards from the hourly hurricane snapshot.
              const now = Date.now();
              const otherHazards = (next.alerts ?? []).filter((alert) => !rapidEvents.has(alert.event ?? "") &&
                (!alert.expires || Date.parse(alert.expires) > now));
              next.alerts = [...otherHazards, ...warnings.alerts];
              next.alerts_status = next.alerts_status === "ready" ? "ready" : "partial";
            }
          } catch {
            next.rapid_alerts_status = "unavailable";
          }
          next.alerts_checked_at = next.checked_at;
        }
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
  const closeImage = () => {
    setBriefingImage(null);
    if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
    imageUrl.current = null;
  };
  const createImage = async () => {
    if (!data?.storm || !a || generatingImage || exportRadarStatus === "loading" || !radarVisible) return;
    setGeneratingImage(true);
    setImageStatus("");
    try {
      // The mosaic can report ready before the browser paints the new map frame.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const blob = await createHurricaneBriefingImage(data, captureMap.current?.() ?? null, exportRadarStatus);
      if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
      const url = URL.createObjectURL(blob);
      imageUrl.current = url;
      setBriefingImage({ url, blob });
    } catch (cause) {
      setImageStatus(cause instanceof Error ? cause.message : "The briefing image could not be generated.");
    } finally { setGeneratingImage(false); }
  };
  const imageFilename = `${data?.storm?.name?.toLowerCase() ?? "storm"}-grand-bay-briefing.png`;
  const shareImage = async () => {
    if (!briefingImage) return;
    const file = new File([briefingImage.blob], imageFilename, { type: "image/png" });
    if (!navigator.share || !navigator.canShare?.({ files: [file] })) {
      setImageStatus("Image sharing is unavailable in this browser. Use Download PNG instead.");
      return;
    }
    try { await navigator.share({ files: [file], title: `${data?.storm?.name ?? "Storm"} · Grand Bay briefing` }); }
    catch (cause) { if (!(cause instanceof Error && cause.name === "AbortError")) setImageStatus("Sharing failed. Use Download PNG instead."); }
  };
  const share = async () => {
    if (!data?.storm || !a) return;
    const text = shareText(data);
    try {
      if (navigator.share) await navigator.share({ title: `${data.storm.name} · Grand Bay watch`, text });
      else { await navigator.clipboard.writeText(text); setShareStatus("Brief copied — paste it into a message."); }
    } catch (cause) {
      if (cause instanceof Error && cause.name !== "AbortError") setShareStatus("Sharing failed. Try Save / print PDF.");
    }
  };
  const printBrief = () => {
    setPrintMap(captureMap.current?.() ?? null);
    const closedWarnings = [...document.querySelectorAll<HTMLDetailsElement>(".hurricane-watch__warnings details:not([open])")];
    closedWarnings.forEach((item) => { item.open = true; });
    window.addEventListener("afterprint", () => closedWarnings.forEach((item) => { item.open = false; }), { once: true });
    window.setTimeout(() => window.print(), 150);
  };
  return <main className="hurricane-watch">
    <header className="hurricane-watch__header"><div><h1><span>{data?.storm?.classification === "HU" ? "Hurricane" : "Storm"}</span> <em>{data?.storm?.name ?? "Gulf"}</em></h1><p>Grand Bay watch · source checks about every five minutes</p></div><Link to="/weather">Weather →</Link></header>
    {error && <p role="alert" className="hurricane-watch__error">{error}</p>}
    {!data && !error && <p role="status">Loading the latest assessment…</p>}
    {data?.status === "pending" && <p role="status">{data.notice}</p>}
    {data?.freshness === "stale" && <p role="alert" className="hurricane-watch__error">Source assessment is stale. Last successful check: {time(data.checked_at)}.</p>}
    {data?.status === "inactive" && <p className="hurricane-watch__error">NHC no longer lists this storm as active. The last assessment remains below.</p>}
    {data?.storm && a && <>
      <div className="hurricane-watch__toolbar"><span className="hurricane-watch__live">{data.status === "active" ? "● LIVE WATCH" : "LAST FORECAST"}</span><span>NHC advisory {a.advisory} · {shortTime(data.storm.lastUpdate)}</span><button className="hurricane-watch__image-action" type="button" disabled={generatingImage || exportRadarStatus === "loading" || !radarVisible} onClick={() => void createImage()}>{generatingImage ? "Creating image…" : !radarVisible ? "Show radar for image" : exportRadarStatus === "loading" ? "Waiting for radar…" : "Create one-page image"}</button><button type="button" onClick={() => void share()}>Share text</button><button type="button" onClick={printBrief}>Print / PDF</button></div>
      {shareStatus && <p role="status" className="hurricane-watch__share-status">{shareStatus}</p>}
      {imageStatus && <p role="status" className="hurricane-watch__share-status">{imageStatus}</p>}
      <section className="hurricane-watch__metrics" aria-label="Official storm status">
        <div><small>{data.status === "inactive" ? "LAST NHC WIND" : "MAX WIND · NHC"}</small><strong>{a.intensity_mph} mph</strong><span>{data.storm.classification} · {data.storm.pressure} mb</span></div>
        <div><small>{data.status === "inactive" ? "LAST CENTER → WATCH POINT" : "CENTER → WATCH POINT"}</small><strong>{a.center_distance_miles} mi</strong><span>{data.status === "inactive" ? "Historical center distance" : "Current center distance"}</span></div>
        <div><small>{data.status === "inactive" ? "LAST FORECAST CENTER" : "CLOSEST FORECAST CENTER"}</small><strong>{a.forecast_point_distance_miles ?? "—"} mi</strong><span>{a.closest_forecast_hour != null ? `At NHC +${a.closest_forecast_hour}h point` : "Track unavailable"}</span></div>
      </section>
      <section className="hurricane-watch__map-section" aria-label="Live radar and official track"><HurricaneMap data={data} registerCapture={(capture) => { captureMap.current = capture; }} onRadarStatus={setExportRadarStatus} onRadarVisible={setRadarVisible} printMap={printMap} /><p className="hurricane-watch__caption">Current IEM NEXRAD mosaic refreshes approximately every 3 minutes; radar coverage can be limited offshore. The NHC cone shows likely center positions, <b>not</b> the full area of wind, surge, rain, or tornado risk.</p></section>
      <section className="hurricane-watch__panel hurricane-watch__warnings"><h2>Grand Bay warning watch</h2><p>{data.watch_point?.label} · {data.alerts_status === "ready" ? `${data.alerts?.length ?? 0} NWS alerts at the pinned point` : "NWS point alerts partially unavailable"}{data.alerts_checked_at ? ` · full hazard check ${time(data.alerts_checked_at)}` : ""}</p>
        {data.alerts?.map((alert) => <details key={alert.id}><summary>{alert.event} · {alert.severity}</summary><p>{alert.headline}</p><p>{alert.description}</p><small>Expires {time(alert.expires)}</small>{alert.url && <p><a href={alert.url} target="_blank" rel="noreferrer">Official warning ↗</a></p>}</details>)}
        <div className="hurricane-watch__coastal-context"><h3>Broader Mobile Coastal zone</h3><p>Regional warnings below are not returned for the exact pinned coordinates. They do not establish address-level flooding, but should not be treated as an all-clear for nearby coastal areas.</p>
          {data.coastal_context_status === "ready" ? data.coastal_context_alerts?.length ? data.coastal_context_alerts.map((alert) => <details key={alert.id}><summary>{alert.event} · regional context</summary><p>{alert.headline}</p><p>{alert.description}</p><small>Expires {time(alert.expires)}</small>{alert.url && <p><a href={alert.url} target="_blank" rel="noreferrer">Official coastal warning ↗</a></p>}</details>) : <p>No additional active coastal-zone warnings beyond those listed for the pinned point.</p> : <p>Coastal-zone check unavailable. <a href="https://api.weather.gov/alerts/active/zone/ALZ265" target="_blank" rel="noreferrer">Check NWS Mobile Coastal alerts ↗</a></p>}
        </div>
      </section>
      <Guidance guidance={data.model_guidance} checkedAt={data.checked_at} />
      <section className="hurricane-watch__panel hurricane-watch__brief"><div><h2>Grand Bay briefing</h2><p>{a.summary}</p>
        {a.intensity_change_mph != null && <p>Wind change since the prior source check: {a.intensity_change_mph > 0 ? "+" : ""}{a.intensity_change_mph} mph.</p>}
        {!!data.changes_since_previous?.model_cycle_changes?.length && <p>New model cycles: {data.changes_since_previous.model_cycle_changes.join(", ")}.</p>}
        {!!data.changes_since_previous?.new_alerts?.length && <p>New point alerts: {data.changes_since_previous.new_alerts.join(", ")}.</p>}
        <p className="hurricane-watch__caution">{a.limitations}</p>
        </div><div className="hurricane-watch__brief-side"><strong>{data.alerts_status === "ready" ? `${data.alerts?.length ?? 0} NWS alerts at watch point` : "Alerts partially unavailable"}</strong><span>Source check {time(data.checked_at)}</span><span>Rapid tornado/severe check {data.rapid_alerts_status === "ready" ? time(data.rapid_alerts_checked_at) : "unavailable"}</span><span>Aegis analyzed {time(data.ai?.analyzed_at)}{data.ai?.reused ? " · no source change" : ""}</span></div></section>
      <section className="hurricane-watch__panel"><h2>Intensity: observed + projected</h2><Trend data={data} /></section>
      <section className="hurricane-watch__panel"><h2>Aegis findings</h2>
        {data.ai?.status === "ready" ? <div className="hurricane-watch__ai"><p>{data.ai.summary}</p>{data.ai.supporting_factors && <p><b>Evidence:</b> {narrative(data.ai.supporting_factors)}</p>}{data.ai.limiting_factors && <p><b>Limits:</b> {narrative(data.ai.limiting_factors)}</p>}{data.ai.uncertainties && <p><b>Uncertainty:</b> {narrative(data.ai.uncertainties)}</p>}{data.ai.recommended_attention && <p><b>Watch next:</b> {narrative(data.ai.recommended_attention)}</p>}<p className="hurricane-watch__caution">Aegis interpretation is not an official forecast or an evacuation instruction. Follow NHC, NWS, and local officials.</p></div>
          : <p className="hurricane-watch__caution">AI commentary unavailable for this cycle; the official source assessment is current.</p>}
      </section>
      <section className="hurricane-watch__panel"><h2>Preliminary storm reports</h2><p>Mobile NWS office · last 36 hours · {data.reports_status === "ready" ? `${data.reports?.length ?? 0} products` : "Feed unavailable"}</p>
        {data.reports?.map((report) => <details key={report.url}><summary>{time(report.issued)} · {report.office}</summary><pre>{report.text}</pre><a href={report.url} target="_blank" rel="noreferrer">Official report ↗</a></details>)}
      </section>
      <details className="hurricane-watch__panel"><summary>Assessment history</summary>{data.history?.map((item, index) => <p key={item.checked_at ?? index}><b>{time(item.checked_at)}</b> · advisory {item.advisory} · {item.intensity_mph} mph<br />{item.summary}</p>)}</details>
      <p className="hurricane-watch__sources"><a href={data.storm.publicAdvisory?.url} target="_blank" rel="noreferrer">NHC advisory ↗</a><a href={data.storm.forecastDiscussion?.url} target="_blank" rel="noreferrer">NHC model discussion ↗</a><a href={data.storm.forecastGraphics?.url} target="_blank" rel="noreferrer">NHC graphics ↗</a><a href="https://mesonet.agron.iastate.edu/docs/nexrad_mosaic/" target="_blank" rel="noreferrer">Radar source ↗</a></p>
    </>}
    {briefingImage && <div className="hurricane-watch__image-modal" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) closeImage(); }}><div className="hurricane-watch__image-dialog" role="dialog" aria-modal="true" aria-labelledby="hurricane-image-title"><div className="hurricane-watch__image-dialog-head"><div><h2 id="hurricane-image-title">One-page hurricane briefing</h2><p>Generated from the current OPS snapshot. Check the issue times before sharing.</p></div><button type="button" onClick={closeImage} aria-label="Close image preview">×</button></div><img src={briefingImage.url} alt={`${data?.storm?.name ?? "Storm"} one-page Grand Bay briefing with radar, official forecast, model guidance, warnings, and analysis`} /><div className="hurricane-watch__image-dialog-actions"><button type="button" onClick={() => void shareImage()}>Share image</button><a href={briefingImage.url} download={imageFilename}>Download PNG</a></div>{imageStatus && <p role="status">{imageStatus}</p>}</div></div>}
  </main>;
}
