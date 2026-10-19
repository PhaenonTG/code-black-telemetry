import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { StormReport } from "./reports";

export default function ReportsMap({ token, reports, selectedId, onSelect }: { token: string | null; reports: StormReport[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  useEffect(() => {
    if (!token || !host.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({ container: host.current, style: "mapbox://styles/mapbox/dark-v11", center: [-88.3, 30.4], zoom: 5.2 });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.addSource("reports", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "report-halo", type: "circle", source: "reports", paint: { "circle-radius": ["case", ["get", "selected"], 19, 13], "circle-color": "#f44835", "circle-opacity": 0.15 } });
      map.addLayer({ id: "report-pins", type: "circle", source: "reports", paint: { "circle-radius": ["case", ["get", "selected"], 10, 7], "circle-color": ["case", ["get", "selected"], "#f44835", "#b94a3e"], "circle-stroke-color": "#fff0e9", "circle-stroke-width": ["case", ["get", "selected"], 2, 1] } });
      map.on("click", "report-pins", (event) => {
        const id = (event.features?.[0] as unknown as { properties?: { id?: unknown } } | undefined)?.properties?.id;
        if (typeof id === "string") onSelectRef.current(id);
      });
      map.on("mouseenter", "report-pins", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "report-pins", () => { map.getCanvas().style.cursor = ""; });
    });
    return () => { mapRef.current = null; map.remove(); };
  }, [token]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => {
      const located = reports.filter((row) => row.latitude != null && row.longitude != null);
      const source = map.getSource("reports") as mapboxgl.GeoJSONSource | undefined;
      source?.setData({ type: "FeatureCollection", features: located.map((row) => ({ type: "Feature", properties: { id: row.id, selected: row.id === selectedId }, geometry: { type: "Point", coordinates: [row.longitude!, row.latitude!] } })) });
      if (!located.length) { map.easeTo({ center: [-88.3, 30.4], zoom: 5.2, duration: 0 }); return; }
      const selected = located.find((row) => row.id === selectedId);
      if (selected) map.easeTo({ center: [selected.longitude!, selected.latitude!], zoom: Math.max(map.getZoom(), 6.2), duration: 450 });
      else { const bounds = new mapboxgl.LngLatBounds(); for (const row of located) bounds.extend([row.longitude!, row.latitude!]); map.fitBounds(bounds, { padding: 45, maxZoom: 7, duration: 450 }); }
    };
    if (map.isStyleLoaded()) update(); else map.once("load", update);
    return () => { map.off("load", update); };
  }, [reports, selectedId]);
  return <div className="reports-map-shell">{token ? <div ref={host} className="reports-map" aria-label="Map of NWS storm report locations"/> : <div className="reports-map-loading">Loading report map…</div>}<span className="reports-map-tag">NWS REPORT LOCATIONS · APPROXIMATE</span></div>;
}
