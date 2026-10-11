import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { PageHeader } from "../components/PageHeader";
import { useCoreOps } from "../core/useCoreOps";
import { getAegisFeed, getAegisStatus, type AegisRadarAlert, type AegisStatus } from "../core/aegisFeed";
import { atlasStyleUri, hasMapboxToken, mapboxAccessToken } from "../../../../src/services/mapTiles";
import "../styles/aegis.css";

const REFRESH_MS = 10_000;

function utc(value: string | undefined): string {
  const parsed = value ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString().replace(".000", "") : "unavailable";
}

function EvidenceMap({ alert }: { alert: AegisRadarAlert }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current || !hasMapboxToken()) return;
    mapboxgl.accessToken = mapboxAccessToken();
    const [lon, lat] = alert.candidate.coordinates;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    const map = new mapboxgl.Map({ container: container.current, style: atlasStyleUri(),
      center: [lon, lat], zoom: 9, attributionControl: true });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.addSource("aegis-evidence", { type: "geojson", data: alert.map as mapboxgl.GeoJSONSourceSpecification["data"] });
      map.addLayer({ id: "aegis-warning-fill", type: "fill", source: "aegis-evidence",
        filter: ["==", ["get", "kind"], "official_warning"], paint: { "fill-color": "#f59e0b", "fill-opacity": 0.16 } });
      map.addLayer({ id: "aegis-warning-outline", type: "line", source: "aegis-evidence",
        filter: ["==", ["get", "kind"], "official_warning"], paint: { "line-color": "#ffbd4b", "line-width": 2 } });
      map.addLayer({ id: "aegis-candidate-halo", type: "circle", source: "aegis-evidence",
        filter: ["==", ["get", "kind"], "unconfirmed_radar_candidate"],
        paint: { "circle-color": "#ef4444", "circle-opacity": 0.22, "circle-radius": 22 } });
      map.addLayer({ id: "aegis-candidate-point", type: "circle", source: "aegis-evidence",
        filter: ["==", ["get", "kind"], "unconfirmed_radar_candidate"],
        paint: { "circle-color": "#f97316", "circle-stroke-color": "#fff", "circle-stroke-width": 2, "circle-radius": 7 } });
    });
    return () => map.remove();
  }, [alert]);
  if (!hasMapboxToken()) return <p className="aegis-map-unavailable">Map unavailable: no Mapbox token in this build.</p>;
  return <div ref={container} className="aegis-map" role="img" aria-label="Official warning polygon and unconfirmed radar candidate point" />;
}

export default function AegisAlerts() {
  const { config } = useCoreOps();
  const [status, setStatus] = useState<AegisStatus | null>(null);
  const [alerts, setAlerts] = useState<AegisRadarAlert[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const poll = async () => {
      try {
        const [state, feed] = await Promise.all([getAegisStatus(config, controller.signal), getAegisFeed(config, controller.signal)]);
        if (controller.signal.aborted) return;
        setStatus(state); setAlerts(feed.items.slice().reverse()); setError(null);
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Feed unavailable");
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), REFRESH_MS);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [config]);
  const selected = alerts.find((item) => item.id === selectedId) || alerts[0] || null;
  return <div className="page aegis-page">
    <PageHeader kicker="FABRIC / SUPPLEMENTAL INTELLIGENCE" title="Aegis Radar Alerts"
      description="Warning-triggered radar evidence. Always follow official NWS warnings; Aegis never issues or cancels one." />
    <div className="aegis-summary">
      <span className={status?.delivery_enabled ? "aegis-state live" : "aegis-state shadow"}>
        {status?.delivery_enabled ? "LIVE DELIVERY" : "SHADOW / NO DELIVERY"}</span>
      <span>Evidence cutoff <b>{status?.screen.cutoff ?? "—"}/100</b></span>
      <span>Last screen <b>{utc(status?.screen.checked_at)}</b></span>
      <span>Sites <b>{status?.screen.sites?.join(", ") || "none"}</b></span>
    </div>
    {error && <p className="aegis-error" role="status">Feed unavailable: {error}. This is not an all-clear.</p>}
    {status?.screen.errors?.length ? <p className="aegis-error" role="status">
      Radar/source errors: {status.screen.errors.map((item) => `${item.site}: ${item.message}`).join("; ")}</p> : null}
    <div className="aegis-grid">
      <section className="aegis-panel" aria-label="Aegis alert feed">
        <h2>Alert feed</h2>
        {!alerts.length && <p className="aegis-empty">No qualifying Aegis alerts in the feed. This does not mean there are no official warnings or hazards.</p>}
        {alerts.map((item) => <button key={item.id} type="button"
          className={`aegis-alert-item${selected?.id === item.id ? " selected" : ""}`}
          onClick={() => setSelectedId(item.id)}>
          <span className="aegis-alert-item__top"><b>{item.official_warning.event}</b><span>{item.rating.evidence_score}/100 evidence</span></span>
          <span>{item.official_warning.headline}</span>
          <small>{item.radar.site} · Scan {utc(item.radar.scan_time)} · Unconfirmed radar candidate</small>
        </button>)}
      </section>
      <section className="aegis-panel" aria-label="Selected radar evidence">
        <h2>Evidence plot</h2>
        {selected ? <>
          <EvidenceMap alert={selected} />
          <div className="aegis-evidence">
            <p><b>Unconfirmed candidate</b> · {selected.candidate.coordinates[1].toFixed(4)}, {selected.candidate.coordinates[0].toFixed(4)}</p>
            <p>Velocity contrast {selected.candidate.shearKt} kt · REF {selected.candidate.reflectivityDbz} dBZ · CC {selected.candidate.cc}</p>
            <p>Evidence: {selected.rating.factors.join(" · ")}</p>
            <p>Score is not a calibrated tornado probability. TDS is not confirmed by this screen.</p>
            <a href={selected.official_warning.source_url} target="_blank" rel="noreferrer">Open official NWS warning ↗</a>
          </div>
        </> : <p className="aegis-empty">A qualifying alert will show its NWS polygon and radar candidate point here.</p>}
      </section>
    </div>
  </div>;
}
