import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { PublicHurricane } from "./types";
import type { WatchLocation } from "./watchLocation";
import { distanceMiles } from "./watchLocation";
import { displayTime } from "./types";

const line = (points: { latitude: number; longitude: number }[]) => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: points.map((point) => [point.longitude, point.latitude]) } });
const empty = () => ({ type: "FeatureCollection" as const, features: [] });
const track = (points: { latitude: number; longitude: number }[]) => points.length > 1 ? line(points) : empty();
const point = (longitude: number, latitude: number) => ({ type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: [longitude, latitude] } });
const tornadoWarningPolygons = (data: PublicHurricane) => ({ type: "FeatureCollection" as const, features: (data.regional_tornado_alerts ?? [])
  .filter((alert) => /^tornado warning$/i.test(alert.event ?? "") && alert.geometry)
  .map((alert) => ({ type: "Feature" as const, properties: { event: alert.event, headline: alert.headline, expires: alert.expires, web: alert.url }, geometry: alert.geometry! })) });
const selectedTrack = (data: PublicHurricane) => data.projection.points;
const historicalPoints = (data: PublicHurricane) => {
  const currentTime = Date.parse(data.storm.last_update ?? "");
  return { type: "FeatureCollection" as const, features: data.observed.track
    .filter((item) => item.valid_time && Number.isFinite(Date.parse(item.valid_time)) && Date.parse(item.valid_time) < currentTime)
    .sort((a, b) => Date.parse(a.valid_time!) - Date.parse(b.valid_time!))
    .map((item) => ({ type: "Feature" as const, properties: { valid_time: item.valid_time, wind_mph: item.wind_mph, pressure_mb: item.pressure_mb }, geometry: { type: "Point" as const, coordinates: [item.longitude, item.latitude] } })) };
};
const historicalTrail = (data: PublicHurricane) => {
  const currentTime = Date.parse(data.storm.last_update ?? "");
  const points = data.observed.track.filter(p => p.valid_time && Number.isFinite(Date.parse(p.valid_time)) && Date.parse(p.valid_time) <= currentTime)
    .sort((a, b) => Date.parse(a.valid_time!) - Date.parse(b.valid_time!));
  const center = data.storm.center;
  const positions = points.map(p => ({ latitude: p.latitude, longitude: p.longitude }));
  if (Number.isFinite(currentTime) && center.latitude != null && center.longitude != null &&
      (!points.length || Date.parse(points.at(-1)!.valid_time!) < currentTime)) positions.push({ latitude: center.latitude, longitude: center.longitude });
  return track(positions);
};
const WMS = "https://nowcoast.noaa.gov/geoserver/ows";
const RADAR_LAYER = "weather_radar:base_reflectivity_mosaic";
const SATELLITE_LAYERS = {
  ir: "satellite:goes_longwave_imagery",
  visible: "satellite:goes_visible_imagery",
  vapor: "satellite:goes_water_vapor_imagery",
  shortwave: "satellite:goes_shortwave_imagery",
} as const;
type SatelliteMode = keyof typeof SATELLITE_LAYERS;
const wmsTiles = (layer: string, intervalMinutes: number) => [`${WMS}?service=WMS&version=1.1.1&request=GetMap&layers=${layer}&styles=&format=image/png&transparent=true&srs=EPSG:3857&bbox={bbox-epsg-3857}&width=512&height=512&v=${Math.floor(Date.now() / (intervalMinutes * 60_000))}`];
const compactTime = (value?: string) => value ? `${new Date(value).toISOString().slice(11, 16)}Z` : "—";


async function sourceTimes(): Promise<{times:Record<string, string>;frames:Record<string,string[]>}> {
  const response = await fetch(`${WMS}?service=WMS&request=GetCapabilities`, { cache: "no-store" });
  if (!response.ok) throw new Error("NOAA source metadata unavailable");
  const xml = new DOMParser().parseFromString(await response.text(), "application/xml");
  const result: Record<string, string> = {};
  const frames: Record<string,string[]> = {};
  for (const layer of Array.from(xml.getElementsByTagName("Layer"))) {
    const name = Array.from(layer.children).find((node) => node.localName === "Name")?.textContent;
    const time = Array.from(layer.children).find((node) => node.localName === "Dimension" && node.getAttribute("name") === "time")?.getAttribute("default");
    if (name && time && !Number.isNaN(Date.parse(time))) result[name] = time;
    const dimension=Array.from(layer.children).find(node=>node.localName==="Dimension" && node.getAttribute("name")==="time");
    if(name && dimension) frames[name]=(dimension.textContent ?? "").split(",").filter(value=>Number.isFinite(Date.parse(value))).slice(-12);
  }
  return {times:result,frames};
}

type ViewMode = "impact" | "approach" | "basin";
const viewPadding = (view: ViewMode) => view === "impact" ? { top: 28, bottom: 28, left: 126, right: 40 } : 24;
function focusBounds(data: PublicHurricane, watch: WatchLocation, view: ViewMode = "impact") {
  const bounds = new mapboxgl.LngLatBounds();
  bounds.extend([watch.longitude, watch.latitude]);
  // Keep the default view on the active coastal window; the other two views
  // retain the longer track and basin context.
  const firstHour = 0, lastHour = view === "basin" ? 72 : view === "approach" ? 24 : 6;
  for (const point of [...selectedTrack(data), ...data.official.track]) {
    if (point.hour >= firstHour && point.hour <= lastHour) bounds.extend([point.longitude, point.latitude]);
  }
  if (data.storm.center.latitude != null && data.storm.center.longitude != null) {
    bounds.extend([data.storm.center.longitude, data.storm.center.latitude]);
    if (view === "approach") {
      bounds.extend([data.storm.center.longitude - 4, data.storm.center.latitude - 3]);
      bounds.extend([data.storm.center.longitude + 4, data.storm.center.latitude + 3]);
    }
  }
  if (view === "impact" && Number.isFinite(Date.parse(data.storm.last_update ?? ""))) {
    const cutoff = Date.parse(data.storm.last_update!) - 4 * 3_600_000;
    for (const observed of data.observed.track) {
      if (observed.valid_time && Date.parse(observed.valid_time) >= cutoff) bounds.extend([observed.longitude, observed.latitude]);
    }
  }
  if (view === "basin") for (const point of data.observed.track) bounds.extend([point.longitude, point.latitude]);
  return bounds;
}

const afterMapIdle = (map: mapboxgl.Map) => new Promise<void>((resolve) => {
  if (map.loaded() && !map.isMoving()) { resolve(); return; }
  const timer = window.setTimeout(() => { map.off("idle", finish); resolve(); }, 5000);
  const finish = () => { window.clearTimeout(timer); resolve(); };
  map.once("idle", finish);
});

export default function HurricaneMap({ data, token, onCapture, watch }: { data: PublicHurricane; token: string | null; onCapture: (capture: (() => Promise<string | null>) | null) => void; watch: WatchLocation }) {
  const host = useRef<HTMLDivElement>(null), mapRef = useRef<mapboxgl.Map | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const watchRef = useRef(watch);
  watchRef.current = watch;
  const [viewMode, setViewMode] = useState<ViewMode>("impact");
  const [radar, setRadar] = useState(false);
  const [clouds, setClouds] = useState(false);
  const [satelliteMode, setSatelliteMode] = useState<SatelliteMode>("shortwave");
  const [alerts, setAlerts] = useState(true);
  const [layerTimes, setLayerTimes] = useState<Record<string, string>>({});
  const [frames,setFrames]=useState<Record<string,string[]>>({});
  const [frame,setFrame]=useState(-1), [playing,setPlaying]=useState(false);
  const frameRef=useRef(-1); frameRef.current=frame;
  const availableFrames=frames[clouds ? SATELLITE_LAYERS[satelliteMode] : RADAR_LAYER] ?? frames["weather_radar:conus_base_reflectivity_mosaic"] ?? [];
  const alertCount = (data.regional_tornado_alerts ?? []).filter((alert) => /^tornado warning$/i.test(alert.event ?? "") && alert.geometry).length;
  const [mapError, setMapError] = useState<string | null>(null);
  const layerState = useRef({ radar, clouds, alerts, satelliteMode });
  layerState.current = { radar, clouds, alerts, satelliteMode };
  const codeBlackTrack = selectedTrack(data);
  useEffect(() => {
    let active = true;
    const refresh = () => { void sourceTimes().then(({times,frames}) => { if (active) {setLayerTimes(times);setFrames(frames);} }).catch(() => {}); };
    refresh();
    const timer = window.setInterval(refresh, 300_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer("radar")) map.setLayoutProperty("radar", "visibility", radar ? "visible" : "none");
  }, [radar]);
  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer("satellite")) map.setLayoutProperty("satellite", "visibility", clouds ? "visible" : "none");
    for (const id of ["aegis", "aegis-halo", "official", "observed"]) {
      if (map?.getLayer(id)) map.setPaintProperty(id, "line-opacity", clouds ? (id === "aegis-halo" ? 0 : 0.17) : ["observed", "aegis-halo"].includes(id) ? 0.8 : 1);
    }
    if (map?.getLayer("observed-points")) map.setPaintProperty("observed-points", "circle-opacity", clouds ? 0.2 : 1);
    if (map?.getLayer("storm-backdrop")) map.setPaintProperty("storm-backdrop", "circle-opacity", clouds ? 0.25 : 1);
    if (map?.getLayer("storm")) map.setPaintProperty("storm", "text-opacity", clouds ? 0.5 : 1);
  }, [clouds]);
  useEffect(() => {
    const source = mapRef.current?.getSource("satellite") as mapboxgl.RasterTileSource | undefined;
    source?.setTiles(wmsTiles(SATELLITE_LAYERS[satelliteMode], 5));
  }, [satelliteMode]);
  useEffect(() => {
    const map = mapRef.current;
    for (const id of ["alert-fill", "alert-outline"]) if (map?.getLayer(id)) map.setLayoutProperty(id, "visibility", alerts ? "visible" : "none");
  }, [alerts]);
  useEffect(() => {
    const source = mapRef.current?.getSource("alerts") as mapboxgl.GeoJSONSource | undefined;
    source?.setData(tornadoWarningPolygons(data) as Parameters<mapboxgl.GeoJSONSource["setData"]>[0]);
  }, [data.regional_tornado_alerts]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource("watch")) return;
    const source = map.getSource("watch") as mapboxgl.GeoJSONSource | undefined;
    source?.setData({ type: "Feature", properties: { label: watch.label }, geometry: { type: "Point", coordinates: [watch.longitude, watch.latitude] } });
    map.setProjection(viewMode === "basin" ? "globe" : "mercator");
    if (viewMode === "basin") {
      map.easeTo({ center: [-89, 29], zoom: 3.15, duration: 500 });
      return;
    }
    const center = data.storm.center;
    if (center.latitude != null && center.longitude != null && distanceMiles({ latitude: center.latitude, longitude: center.longitude }, watch) < 700)
      map.fitBounds(focusBounds(data, watch, viewMode), { padding: viewPadding(viewMode), maxZoom: viewMode === "impact" ? 7.8 : 6.8, duration: 500 });
    else map.easeTo({ center: [watch.longitude, watch.latitude], zoom: 5, duration: 500 });
  }, [watch, viewMode, data.storm.last_update]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource("watch")) return;
    const set = (id: string, value: Parameters<mapboxgl.GeoJSONSource["setData"]>[0]) =>
      (map.getSource(id) as mapboxgl.GeoJSONSource | undefined)?.setData(value);
    const center = data.storm.center;
    set("aegis", track(codeBlackTrack));
    set("official", track(data.official.track));
    set("observed", historicalTrail(data));
    set("observed-points", historicalPoints(data));
    set("storm", center.longitude != null && center.latitude != null ? point(center.longitude, center.latitude) : empty());
  }, [data, codeBlackTrack]);
  useEffect(() => {
    if (!token || !host.current || !data.storm.center.latitude || !data.storm.center.longitude) return;
    let tileTimer: number | undefined, pulseFrame: number | undefined;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({ container: host.current, style: "mapbox://styles/mapbox/dark-v11", center: [data.storm.center.longitude, data.storm.center.latitude],
      zoom: 4.3, dragPan: false, dragRotate: false, scrollZoom: false, boxZoom: false, doubleClickZoom: false, touchZoomRotate: false, touchPitch: false, keyboard: false, preserveDrawingBuffer: true, attributionControl: true });
    mapRef.current = map;
    onCapture(async () => {
      const data = dataRef.current;
      const container = host.current;
      if (!container) return null;
      await afterMapIdle(map);
      if (!map.getSource("watch")) return null;
      (map.getSource("watch") as mapboxgl.GeoJSONSource).setData({type:"Feature",properties:{label:watchRef.current.label},geometry:{type:"Point",coordinates:[watchRef.current.longitude,watchRef.current.latitude]}});
      const originalStyle = container.getAttribute("style");
      const camera = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
      const originalProjection = map.getProjection().name;
      try {
        Object.assign(container.style, { position: "fixed", left: "-2000px", top: "0" });
        // The phone stylesheet intentionally uses an !important map height.
        // Override it with equal priority during the off-screen export so the
        // captured image fills its intended landscape canvas.
        container.style.setProperty("width", "1440px", "important");
        container.style.setProperty("height", "800px", "important");
        map.resize();
        map.setProjection("mercator");
        map.fitBounds(focusBounds(data, watchRef.current, "approach"), { padding: { top: 56, bottom: 54, left: 56, right: 56 }, maxZoom: 7.8, duration: 0 });
        await afterMapIdle(map);
        return map.getCanvas().toDataURL("image/png");
      } catch { return null; }
      finally {
        if (originalStyle === null) container.removeAttribute("style"); else container.setAttribute("style", originalStyle);
        map.resize();
        map.setProjection(originalProjection);
        map.jumpTo(camera);
      }
    });

    map.on("error", () => setMapError("Map tiles are temporarily unavailable. Track details remain below."));
    map.on("load", () => {
      const data = dataRef.current;
      const codeBlackTrack = selectedTrack(data);
      map.addSource("satellite", { type: "raster", tiles: wmsTiles(SATELLITE_LAYERS[layerState.current.satelliteMode], 5), tileSize: 512, attribution: "NOAA nowCOAST" });
      map.addLayer({ id: "satellite", type: "raster", source: "satellite", layout: { visibility: layerState.current.clouds ? "visible" : "none" }, paint: { "raster-opacity": 0.8, "raster-fade-duration": 0 } });
      map.addSource("radar", { type: "raster", tiles: wmsTiles(RADAR_LAYER, 2), tileSize: 512, attribution: "NOAA nowCOAST" });
      map.addLayer({ id: "radar", type: "raster", source: "radar", layout: { visibility: layerState.current.radar ? "visible" : "none" }, paint: { "raster-opacity": 0.78, "raster-fade-duration": 0 } });
      map.addSource("alerts", { type: "geojson", data: tornadoWarningPolygons(data), attribution: "NWS" });
      map.addLayer({ id: "alert-fill", type: "fill", source: "alerts", layout: { visibility: layerState.current.alerts ? "visible" : "none" }, paint: { "fill-color": "#e73831", "fill-opacity": 0.15 } });
      map.addLayer({ id: "alert-outline", type: "line", source: "alerts", layout: { visibility: layerState.current.alerts ? "visible" : "none" }, paint: { "line-color": "#ff6158", "line-opacity": 0.98, "line-width": 2.5 } });
      map.on("click", "alert-fill", (event) => {
        const props = (event.features?.[0] as unknown as { properties?: { event?: string; headline?: string; expires?: string } } | undefined)?.properties;
        if (props) new mapboxgl.Popup({ maxWidth: "260px" }).setLngLat(event.lngLat).setText(`${props.event ?? "NWS alert"}${props.headline ? ` · ${props.headline}` : ""}`).addTo(map);
      });
      let radarVersion = Math.floor(Date.now() / 120_000), satelliteVersion = Math.floor(Date.now() / 300_000);
      tileTimer = window.setInterval(() => {
        if (frameRef.current >= 0 || document.hidden) return;
        const nextRadar = Math.floor(Date.now() / 120_000), nextSatellite = Math.floor(Date.now() / 300_000);
        if (nextRadar !== radarVersion) {
          radarVersion = nextRadar;
          (map.getSource("radar") as mapboxgl.RasterTileSource | undefined)?.setTiles(wmsTiles(RADAR_LAYER, 2));
        }
        if (nextSatellite !== satelliteVersion) {
          satelliteVersion = nextSatellite;
          (map.getSource("satellite") as mapboxgl.RasterTileSource | undefined)?.setTiles(wmsTiles(SATELLITE_LAYERS[layerState.current.satelliteMode], 5));
        }
      }, 30_000);
      {
        map.addSource("observed", { type: "geojson", data: historicalTrail(data) });
        map.addLayer({ id: "observed", type: "line", source: "observed", paint: { "line-color": "#9a9da3", "line-width": 2, "line-opacity": 0.8 } });
        map.addSource("observed-points", { type: "geojson", data: historicalPoints(data) });
        map.addLayer({ id: "observed-points", type: "circle", source: "observed-points", paint: { "circle-radius": 3, "circle-color": "#c1c2c5", "circle-stroke-color": "#0d0d0d", "circle-stroke-width": 1.5 } });
        map.addSource("official", { type: "geojson", data: track(data.official.track) });
        map.addLayer({ id: "official", type: "line", source: "official", paint: { "line-color": "#e31919", "line-width": 3.5 } });
        map.addSource("aegis", { type: "geojson", data: track(codeBlackTrack) });
        map.addLayer({ id: "aegis-halo", type: "line", source: "aegis", paint: { "line-color": "#0d0d0d", "line-width": 6, "line-opacity": 0.8 } });
        map.addLayer({ id: "aegis", type: "line", source: "aegis", paint: { "line-color": "#f4f4f5", "line-width": 2.25, "line-dasharray": [2, 1.5] } });
        if (layerState.current.clouds) {
          for (const id of ["aegis", "official", "observed"]) map.setPaintProperty(id, "line-opacity", 0.17);
          map.setPaintProperty("aegis-halo", "line-opacity", 0);
          map.setPaintProperty("observed-points", "circle-opacity", 0.2);
        }
      }
      const center = data.storm.center;
      map.addSource("storm", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [center.longitude!, center.latitude!] } } });
      // NHC cone graphics mark the current cyclone center with an X. Keep this
      // distinct from forecast dots and the cyan watch point.
      map.addLayer({ id: "storm-backdrop", type: "circle", source: "storm", paint: { "circle-radius": 13, "circle-color": "#0d0d0d", "circle-stroke-color": "#e31919", "circle-stroke-width": 2.5 } });
      map.addLayer({ id: "storm", type: "symbol", source: "storm", layout: { "text-field": "X", "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"], "text-size": 21, "text-allow-overlap": true }, paint: { "text-color": "#fff", "text-halo-color": "#080b11", "text-halo-width": 1 } });
      map.addSource("watch", { type: "geojson", data: { type: "Feature", properties: { label: watchRef.current.label }, geometry: { type: "Point", coordinates: [watchRef.current.longitude, watchRef.current.latitude] } } });
      map.addLayer({ id: "watch-halo", type: "circle", source: "watch", paint: { "circle-radius": 15, "circle-color": "#f4f4f5", "circle-opacity": 0.16 } });
      map.addLayer({ id: "watch", type: "circle", source: "watch", paint: { "circle-radius": 7, "circle-color": "#f4f4f5", "circle-stroke-color": "#0d0d0d", "circle-stroke-width": 2 } });
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const pulse = (at: number) => {
          if (!map.getLayer("watch-halo")) return;
          const phase = (Math.sin(at / 620) + 1) / 2;
          map.setPaintProperty("watch-halo", "circle-radius", 13 + phase * 10);
          map.setPaintProperty("watch-halo", "circle-opacity", 0.10 + phase * 0.22);
          pulseFrame = window.requestAnimationFrame(pulse);
        };
        pulseFrame = window.requestAnimationFrame(pulse);
      }
      map.addLayer({ id: "watch-label", type: "symbol", source: "watch", layout: { "text-field": ["get", "label"], "text-size": 13, "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"], "text-anchor": "right", "text-offset": [-1.2, -0.2], "text-allow-overlap": true }, paint: { "text-color": "#f4f4f5", "text-halo-color": "#0d0d0d", "text-halo-width": 2 } });
      map.on("click", "watch", () => new mapboxgl.Popup({ maxWidth: "220px" }).setLngLat([watchRef.current.longitude, watchRef.current.latitude]).setText(`Watch location: ${watchRef.current.label}`).addTo(map));
      map.on("click", "observed-points", (event) => {
        const props = (event.features?.[0] as unknown as { properties?: { valid_time?: string; wind_mph?: number | null; pressure_mb?: number | null } } | undefined)?.properties;
        if (!props) return;
        const details = [props.valid_time ? displayTime(props.valid_time) : "Observed position", props.wind_mph == null ? null : `${props.wind_mph} mph`, props.pressure_mb == null ? null : `${props.pressure_mb} mb`].filter(Boolean).join(" · ");
        new mapboxgl.Popup({ maxWidth: "230px" }).setLngLat(event.lngLat).setText(details).addTo(map);
      });
      map.on("mouseenter", "observed-points", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "observed-points", () => { map.getCanvas().style.cursor = ""; });
      map.fitBounds(focusBounds(data, watchRef.current, viewMode), { padding: viewPadding(viewMode), maxZoom: 7.8, duration: 0 });
    });
    return () => { if (tileTimer) window.clearInterval(tileTimer); if (pulseFrame) window.cancelAnimationFrame(pulseFrame); onCapture(null); mapRef.current = null; map.remove(); };
  }, [token, onCapture]);
  useEffect(()=>{
    if(!playing || availableFrames.length<2) return;
    const timer=window.setInterval(()=>{if(!document.hidden)setFrame(value=>(value+1)%availableFrames.length)},1800);
    return ()=>clearInterval(timer);
  },[playing,availableFrames.length]);
  useEffect(()=>{
    const map=mapRef.current;if(!map) return;
    const time=frame>=0 ? availableFrames[frame] : null;
    for(const [id,layer] of [["radar",RADAR_LAYER],["satellite",SATELLITE_LAYERS[satelliteMode]]]) {
      const source=map.getSource(id) as mapboxgl.RasterTileSource | undefined;
      source?.setTiles(wmsTiles(layer,5).map(url=>time ? `${url}&time=${encodeURIComponent(time)}` : url));
    }
  },[frame,availableFrames,clouds,satelliteMode]);
  return <div className="map-block"><div className="map-heading"><h2>Live storm</h2><span className="map-heading__status" title={displayTime(data.storm.last_update)}>Position · {displayTime(data.storm.last_update)}</span></div>
    <div className="map-frame">{token ? <div ref={host} className="map-canvas" aria-label="Current storm position and projected path" /> : <div className="map-fallback">Loading live map…</div>}
      {clouds && <div className="satellite-map-tag">GOES · {satelliteMode === "ir" ? "Infrared" : satelliteMode === "vapor" ? "Water vapor" : satelliteMode === "shortwave" ? "Shortwave IR" : "Visible"} · {compactTime(frame>=0 ? availableFrames[frame] : layerTimes[SATELLITE_LAYERS[satelliteMode]])}</div>}
      {mapError && <div className="map-error" role="status">{mapError}</div>}</div>
    <div className="map-actions map-actions--primary"><button type="button" aria-pressed={radar} onClick={() => setRadar((on) => !on)}>Radar {radar ? "On" : "Off"}</button><button type="button" aria-pressed={clouds} onClick={() => setClouds((on) => !on)}>Satellite {clouds ? "On" : "Off"}</button><button type="button" aria-pressed={alerts} onClick={() => setAlerts((on) => !on)}>Tornado warnings {alerts ? "On" : "Off"}</button></div><details className="map-controls"><summary>Map layers & views</summary>
    <div className="map-products"><label htmlFor="goes-product">Satellite product</label><select id="goes-product" value={satelliteMode} onChange={(event) => { setSatelliteMode(event.target.value as SatelliteMode); setClouds(true); }}><option value="ir">Infrared</option><option value="visible">Visible</option><option value="vapor">Water vapor</option><option value="shortwave">Shortwave IR</option></select><span>Radar {compactTime(layerTimes["weather_radar:conus_base_reflectivity_mosaic"])} · GOES {compactTime(layerTimes[SATELLITE_LAYERS[satelliteMode]])}{alerts ? ` · Tornado warnings ${alertCount}` : ""}</span><a href="https://nowcoast.noaa.gov/" target="_blank" rel="noreferrer">NOAA ↗</a></div>
    <div className="map-view-switch" role="group" aria-label="Map view"><button type="button" aria-pressed={viewMode === "approach"} onClick={() => setViewMode("approach")}>Storm</button><button type="button" aria-pressed={viewMode === "impact"} onClick={() => setViewMode("impact")}>Coast / local</button><button type="button" aria-pressed={viewMode === "basin"} onClick={() => setViewMode("basin")}>Basin</button></div></details>
    {(radar || clouds) && <div className="imagery-playback"><button type="button" disabled={availableFrames.length<2} onClick={()=>{setPlaying(v=>!v);if(frame<0)setFrame(0);}}>{playing ? "Pause" : "Play"}</button><input aria-label="Imagery frame" type="range" min={0} max={Math.max(0,availableFrames.length-1)} value={frame<0 ? Math.max(0,availableFrames.length-1) : frame} onChange={e=>{setPlaying(false);setFrame(Number(e.target.value));}}/><button type="button" onClick={()=>{setPlaying(false);setFrame(-1);}}>Live</button><span>{frame>=0 ? compactTime(availableFrames[frame]) : "Latest imagery"}</span></div>}
    <div className="map-legend"><span><i className="key-center">X</i>Current NHC position</span><span><i className="key-observed"/>Past positions · tap for details</span><span><i className="key-aegis"/>Code Black Experimental</span><span><i className="key-nhc"/>NHC official</span><span><i className="key-watch"/>{watch.label}</span></div>
  </div>;
}
