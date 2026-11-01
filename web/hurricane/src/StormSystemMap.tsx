import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { StormPoint, StormSystem } from "./stormSystem";

const coordinates = (points: StormPoint[] | undefined): [number, number][] => (points ?? [])
  .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
  .map((point) => [point.longitude, point.latitude]);
const line = (points: [number, number][]) => ({ type: "FeatureCollection" as const, features: points.length > 1 ? [{
  type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: points },
}] : [] });
const dots = (points: [number, number][]) => ({ type: "FeatureCollection" as const, features: points.map((point) => ({
  type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: point },
})) });

export default function StormSystemMap({ data, token, selectedModels }: { data: StormSystem; token: string | null; selectedModels: string[] }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current || !token) return;
    mapboxgl.accessToken = token;
    const official = coordinates(data.track);
    const observedRows = data.observed_track?.length ? data.observed_track : data.reported_centers ?? [];
    const centerTime = Date.parse(data.nhc_updated_at ?? "");
    const recentObserved = observedRows.filter((point) => !Number.isFinite(centerTime) || !point.valid_time ||
      Date.parse(point.valid_time) >= centerTime - 36 * 3_600_000).slice(-16);
    const observed = coordinates(recentObserved);
    const officialHorizon = Math.max(0, ...(data.track ?? []).map((point) => point.hour ?? 0));
    // Keep the map focused on the period covered by NHC's published forecast.
    // Experimental/model aids can extend much farther and otherwise make the active storm disappear.
    const withinOfficialHorizon = (points: StormPoint[] | undefined) => coordinates(points?.filter((point) => point.hour == null || point.hour <= officialHorizon));
    const experiment = data.projection?.status === "ready" ? withinOfficialHorizon(data.projection.points) : [];
    const modelTracks = data.guidance?.models.filter((model) => selectedModels.includes(model.id)).map((model) => withinOfficialHorizon(model.points)) ?? [];
    const all = [...official, ...observed, ...experiment, ...modelTracks.flat()];
    const center = data.current_center?.latitude != null && data.current_center.longitude != null
      ? [data.current_center.longitude, data.current_center.latitude] as [number, number] : official[0] ?? [0, 20];
    const map = new mapboxgl.Map({ container: container.current, style: "mapbox://styles/mapbox/dark-v11",
      center, zoom: 3, interactive: false, attributionControl: true, preserveDrawingBuffer: false });
    map.on("load", () => {
      const addLine = (name: string, points: [number, number][], color: string, width: number, dash?: number[]) => {
        if (points.length < 2) return;
        map.addSource(name, { type: "geojson", data: line(points) });
        map.addLayer({ id: name, type: "line", source: name, paint: { "line-color": color, "line-width": width,
          "line-opacity": .94, ...(dash ? { "line-dasharray": dash } : {}) } });
      };
      modelTracks.forEach((points, index) => addLine(`model-${index}`, points, "#74777c", 1));
      addLine("observed", observed, "#a2a4a8", 2);
      addLine("nhc", official, "#e31919", 3);
      addLine("experimental", experiment, "#f4f4f5", 2, [3, 3]);
      if (observed.length) {
        map.addSource("observed-dots", { type: "geojson", data: dots(observed) });
        map.addLayer({ id: "observed-dots", type: "circle", source: "observed-dots", paint: {
          "circle-radius": 3, "circle-color": "#a2a4a8", "circle-stroke-color": "#0d0d0d", "circle-stroke-width": 1 } });
      }
      map.addSource("current-center", { type: "geojson", data: dots([center]) });
      map.addLayer({ id: "current-center", type: "circle", source: "current-center", paint: {
        "circle-radius": 7, "circle-color": "#0d0d0d", "circle-stroke-color": "#f4f4f5", "circle-stroke-width": 2 } });
      if (all.length) {
        const bounds = new mapboxgl.LngLatBounds();
        all.forEach((point) => bounds.extend(point));
        bounds.extend(center);
        map.fitBounds(bounds, { padding: 35, maxZoom: 6, duration: 0 });
      }
    });
    return () => { map.remove(); };
  }, [data, token, selectedModels]);
  return <div className="system-map" ref={container} role="img" aria-label={`Map of ${data.name ?? "storm"} official NHC forecast, reported center history, and available experimental guidance`}/>;
}
