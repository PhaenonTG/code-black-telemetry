import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { PublicHurricane } from "./types";
import type { WatchLocation } from "./watchLocation";
import { distanceMiles } from "./watchLocation";

const colors: Record<string, string> = { HFAI: "#e9b568", HFBI: "#bca9ef", AVNI: "#82aaff", HCCA: "#d8ddd8", TVCN: "#90b987" };
const line = (points: { latitude: number; longitude: number }[]) => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: points.map((point) => [point.longitude, point.latitude]) } });

export default function HurricaneMap({ data, token, onCapture, watch }: { data: PublicHurricane; token: string | null; onCapture: (capture: (() => string | null) | null) => void; watch: WatchLocation }) {
  const host = useRef<HTMLDivElement>(null), mapRef = useRef<mapboxgl.Map | null>(null);
  const watchRef = useRef(watch);
  watchRef.current = watch;
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [radar, setRadar] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const models = data.guidance.models;
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    for (const model of models) if (map.getLayer(`model-${model.id}`)) map.setLayoutProperty(`model-${model.id}`, "visibility", selectedModels.includes(model.id) ? "visible" : "none");
  }, [selectedModels, models]);
  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer("radar")) map.setLayoutProperty("radar", "visibility", radar ? "visible" : "none");
  }, [radar]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    const source = map.getSource("watch") as mapboxgl.GeoJSONSource | undefined;
    source?.setData({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [watch.longitude, watch.latitude] } });
    const center = data.storm.center;
    if (center.latitude != null && center.longitude != null && distanceMiles({ latitude: center.latitude, longitude: center.longitude }, watch) < 700) {
      const bounds = new mapboxgl.LngLatBounds();
      bounds.extend([watch.longitude, watch.latitude]);
      for (const point of data.official.track.filter((item) => item.hour <= 48)) bounds.extend([point.longitude, point.latitude]);
      bounds.extend([center.longitude, center.latitude]);
      map.fitBounds(bounds, { padding: 65, maxZoom: 6, duration: 500 });
    } else map.easeTo({ center: [watch.longitude, watch.latitude], zoom: 5, duration: 500 });
  }, [watch, data]);
  useEffect(() => {
    if (!token || !host.current || !data.storm.center.latitude || !data.storm.center.longitude) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({ container: host.current, style: "mapbox://styles/mapbox/dark-v11", center: [data.storm.center.longitude, data.storm.center.latitude],
      zoom: 4.3, preserveDrawingBuffer: true, attributionControl: true });
    mapRef.current = map;
    onCapture(() => { try { return map.getCanvas().toDataURL("image/png"); } catch { return null; } });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.on("error", () => setMapError("Map tiles are temporarily unavailable. Track details remain below."));
    map.on("load", () => {
      map.addSource("radar", { type: "raster", tiles: [`https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png?v=${Math.floor(Date.now() / 300000)}`], tileSize: 256 });
      map.addLayer({ id: "radar", type: "raster", source: "radar", layout: { visibility: radar ? "visible" : "none" }, paint: { "raster-opacity": 0.48 } });
      if (data.official.cone.length >= 4) {
        map.addSource("cone", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [data.official.cone] } } });
        map.addLayer({ id: "cone-fill", type: "fill", source: "cone", paint: { "fill-color": "#e8f0ef", "fill-opacity": 0.1 } });
        map.addLayer({ id: "cone-edge", type: "line", source: "cone", paint: { "line-color": "#e8f0ef", "line-opacity": 0.55, "line-width": 1.5 } });
      }
      if (data.observed.track.length > 1) {
        map.addSource("observed", { type: "geojson", data: line(data.observed.track) });
        map.addLayer({ id: "observed", type: "line", source: "observed", paint: { "line-color": "#f16e65", "line-width": 3 } });
      }
      if (data.official.track.length > 1) {
        map.addSource("official", { type: "geojson", data: line(data.official.track) });
        map.addLayer({ id: "official", type: "line", source: "official", paint: { "line-color": "#f2f4ef", "line-width": 3, "line-dasharray": [2, 1.5] } });
      }
      for (const model of models) {
        if (model.points.length < 2) continue;
        map.addSource(`model-${model.id}`, { type: "geojson", data: line(model.points) });
        map.addLayer({ id: `model-${model.id}`, type: "line", source: `model-${model.id}`, layout: { visibility: selectedModels.includes(model.id) ? "visible" : "none" },
          paint: { "line-color": colors[model.id] ?? "#acbfd0", "line-width": 2, "line-opacity": 0.9 } });
      }
      if (data.projection.points.length > 1) {
        map.addSource("aegis", { type: "geojson", data: line(data.projection.points) });
        map.addLayer({ id: "aegis-halo", type: "line", source: "aegis", paint: { "line-color": "#06121c", "line-width": 8, "line-opacity": 0.8 } });
        map.addLayer({ id: "aegis", type: "line", source: "aegis", paint: { "line-color": "#45d9d1", "line-width": 4 } });
        map.addSource("aegis-points", { type: "geojson", data: { type: "FeatureCollection", features: data.projection.points.filter((p) => p.hour % 12 === 0).map((p) => ({ type: "Feature", properties: { hour: p.hour, spread: p.spread_miles, members: p.members }, geometry: { type: "Point", coordinates: [p.longitude, p.latitude] } })) } });
        map.addLayer({ id: "aegis-dots", type: "circle", source: "aegis-points", paint: { "circle-radius": 4, "circle-color": "#45d9d1", "circle-stroke-color": "#06121c", "circle-stroke-width": 1.5 } });
        map.on("click", "aegis-dots", (event) => {
          const feature = event.features?.[0] as unknown as { geometry: { type: string; coordinates: number[] }; properties?: Record<string, number> } | undefined;
          if (!feature || feature.geometry.type !== "Point") return;
          new mapboxgl.Popup({ closeButton: false, maxWidth: "220px" }).setLngLat(feature.geometry.coordinates as [number, number])
            .setText(`Aegis blend +${feature.properties?.hour}h · model center spread ${feature.properties?.spread} mi · ${feature.properties?.members} members`).addTo(map);
        });
      }
      const center = data.storm.center;
      map.addSource("storm", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [center.longitude!, center.latitude!] } } });
      map.addLayer({ id: "storm", type: "circle", source: "storm", paint: { "circle-radius": 9, "circle-color": "#fb716a", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
      map.addSource("watch", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [watchRef.current.longitude, watchRef.current.latitude] } } });
      map.addLayer({ id: "watch-halo", type: "circle", source: "watch", paint: { "circle-radius": 15, "circle-color": "#45d9d1", "circle-opacity": 0.16 } });
      map.addLayer({ id: "watch", type: "circle", source: "watch", paint: { "circle-radius": 7, "circle-color": "#45d9d1", "circle-stroke-color": "#06121c", "circle-stroke-width": 2 } });
      map.on("click", "watch", () => new mapboxgl.Popup({ maxWidth: "220px" }).setLngLat([watchRef.current.longitude, watchRef.current.latitude]).setText(`Watch location: ${watchRef.current.label}`).addTo(map));
      // Lead with the active Gulf/landfall window; visitors can pan to later days.
      const positions = [...data.official.track.filter((p) => p.hour <= 48), ...data.projection.points.filter((p) => p.hour <= 48), ...data.observed.track.slice(-4)];
      if (positions.length > 1) {
        const bounds = new mapboxgl.LngLatBounds();
        for (const p of positions) bounds.extend([p.longitude, p.latitude]);
        if (distanceMiles({ latitude: center.latitude!, longitude: center.longitude! }, watchRef.current) < 700) bounds.extend([watchRef.current.longitude, watchRef.current.latitude]);
        map.fitBounds(bounds, { padding: { top: 65, bottom: 65, left: 65, right: 65 }, maxZoom: 6, duration: 0 });
      }
    });
    return () => { onCapture(null); mapRef.current = null; map.remove(); };
  }, [data, token, onCapture]);
  const toggle = (id: string) => setSelectedModels((selected) => selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  return <div className="map-block"><div className="map-heading"><h2>Projection map</h2><div className="map-actions"><button type="button" aria-pressed={radar} onClick={() => setRadar((on) => !on)}>Radar {radar ? "on" : "off"}</button></div></div>
    <div className="map-frame">{token ? <div ref={host} className="map-canvas" aria-label="Interactive Gulf hurricane map with watch location, Aegis, NHC, and model tracks" /> : <div className="map-fallback">Loading live map…</div>}
      {mapError && <div className="map-error" role="status">{mapError}</div>}
      <div className="map-legend"><span><i className="key-aegis"/>Aegis blend · experimental</span><span><i className="key-nhc"/>NHC official</span><span><i className="key-observed"/>Observed center</span><span><i className="key-watch"/>Watch location</span></div></div>
    <div className="model-switches"><strong>Optional model tracks</strong>{models.map((model) => <button key={model.id} type="button" aria-pressed={selectedModels.includes(model.id)} onClick={() => toggle(model.id)} style={{ "--model-color": colors[model.id] ?? "#acbfd0" } as React.CSSProperties}>{model.name}</button>)}</div>
    <p className="map-caption">Paths depict storm centers, not the full wind, surge, rainfall, or tornado hazard. Radar is observed precipitation; it is not a forecast. Map attribution appears on the map.</p>
  </div>;
}
