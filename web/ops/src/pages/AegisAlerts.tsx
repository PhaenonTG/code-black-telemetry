import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { PageHeader } from "../components/PageHeader";
import { useCoreOps } from "../core/useCoreOps";
import { getAegisFeed, getAegisObservationPlan, getAegisStatus, replayAegisPolicy, type AegisObservationPlan,
  type AegisRadarAlert, type AegisRecordedReplay, type AegisStatus } from "../core/aegisFeed";
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

export default function AegisAlerts({ embedded = false }: { embedded?: boolean }) {
  const { config } = useCoreOps();
  const [status, setStatus] = useState<AegisStatus | null>(null);
  const [plan, setPlan] = useState<AegisObservationPlan | null>(null);
  const [alerts, setAlerts] = useState<AegisRadarAlert[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<AegisRecordedReplay | null>(null);
  const [recordedError, setRecordedError] = useState<string | null>(null);
  const [selectedVolume, setSelectedVolume] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const poll = async () => {
      try {
        const [state, feed, observationPlan] = await Promise.all([
          getAegisStatus(config, controller.signal),
          getAegisFeed(config, controller.signal),
          getAegisObservationPlan(config, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setStatus(state); setPlan(observationPlan); setAlerts(feed.items.slice().reverse()); setError(null);
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Feed unavailable");
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), REFRESH_MS);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [config]);
  useEffect(() => {
    const controller = new AbortController();
    const poll = async () => {
      try {
        const result = await replayAegisPolicy<AegisRecordedReplay>(config,
          { mode: "recorded", evidenceCutoff: status?.screen.cutoff ?? 85, limit: 10 }, controller.signal);
        if (result.mode !== "recorded") throw new Error("Unexpected Core replay mode");
        if (!controller.signal.aborted) { setRecorded(result); setRecordedError(null); }
      } catch (caught) {
        if (!controller.signal.aborted) {
          setRecorded(null);
          setRecordedError(caught instanceof Error ? caught.message : "Recorded scans unavailable");
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 30_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [config, status?.screen.cutoff]);
  const selected = alerts.find((item) => item.id === selectedId) || alerts[0] || null;
  const selectedScan = recorded?.scans.find((scan) => scan.volume_key === selectedVolume)
    || recorded?.scans.at(-1) || null;
  return <div className={embedded ? "aegis-page" : "page aegis-page"}>
    {embedded ? <header className="analysis-surveillance-heading"><h2>Radar surveillance</h2><p>Warning-triggered radar evidence. Always follow official NWS warnings; Aegis never issues or cancels one.</p></header> : <PageHeader kicker="FABRIC / SUPPLEMENTAL INTELLIGENCE" title="Aegis Radar Alerts"
      description="Warning-triggered radar evidence. Always follow official NWS warnings; Aegis never issues or cancels one." />}
    <div className="aegis-summary">
      <span className={status?.delivery_enabled ? "aegis-state live" : "aegis-state shadow"}>
        {status?.delivery_enabled ? "LIVE DELIVERY" : "SHADOW / NO DELIVERY"}</span>
      <span>Evidence cutoff <b>{status?.screen.cutoff ?? "—"}/100</b></span>
      <span>Last screen <b>{utc(status?.screen.checked_at)}</b></span>
      <span>Sites <b>{status?.screen.sites?.join(", ") || "none"}</b></span>
      <Link to="/automation-lab">Rehearse alert routing →</Link>
    </div>
    {error && <p className="aegis-error" role="status">Feed unavailable: {error}. This is not an all-clear.</p>}
    {status?.screen.errors?.length ? <p className="aegis-error" role="status">
      Radar/source errors: {status.screen.errors.map((item) => `${item.site}: ${item.message}`).join("; ")}</p> : null}
    <section className="aegis-panel aegis-observation" aria-label="Active Aegis observation plan">
      <div className="aegis-review__heading">
        <div><p className="aegis-review__kicker">CONTINUOUS SURVEILLANCE / READ-ONLY</p><h2>Active observation plan</h2></div>
        <span>{plan ? plan.executor.state.replaceAll("_", " ") : "Connecting to Core"}</span>
      </div>
      {plan ? <>
        <p className="aegis-empty">Last executor check {utc(plan.executor.last_checked_at ?? undefined)} · {plan.setup_drafts.length} setup draft{plan.setup_drafts.length === 1 ? "" : "s"} under observation · {plan.live_chasers.length} live chaser{plan.live_chasers.length === 1 ? "" : "s"}.</p>
        <div className="aegis-review__products" aria-label="Observation evidence gates">
          {Object.entries(plan.gates).map(([gate, state]) => <span key={gate} className={state.includes("ready") ? "available" : "missing"}>{gate.replaceAll("_", " ")} · {state.replaceAll("_", " ")}</span>)}
          <span className={plan.radar?.available ? "available" : "missing"}>radar · {plan.radar?.dominant_cell?.available ? "tracked cell" : plan.radar?.dominant_cell?.freshness_state?.replaceAll("_", " ") || "unavailable"}</span>
          <span className={plan.satellite?.state === "available_metadata_only" ? "available" : "missing"}>satellite · {plan.satellite?.satellite || plan.satellite?.analysis_state || "unavailable"}</span>
        </div>
        <p className="aegis-empty">{plan.executor.notice || "Observation evidence is recorded without routing a vehicle or issuing an official warning."}</p>
      </> : <p className="aegis-empty">Loading executor, radar, satellite, and setup-surveillance state.</p>}
    </section>
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
    <section className="aegis-panel aegis-review" aria-label="Recorded radar screenings">
      <div className="aegis-review__heading">
        <div><p className="aegis-review__kicker">SHADOW REVIEW / CORE RECORDS</p><h2>Recent radar screenings</h2></div>
        <span>{recorded ? `${recorded.scans_reviewed} scans · ${recorded.candidates_reviewed} captured candidates` : "Awaiting Core"}</span>
      </div>
      <p className="aegis-empty">These are saved screening records, not published alerts or verified tornado reports. A missing candidate is not an all-clear.</p>
      {recordedError && <p className="aegis-error" role="status">Recorded scans unavailable: {recordedError}</p>}
      {recorded && recorded.scans.length === 0 && <p className="aegis-empty">No radar screenings have been recorded yet.</p>}
      {recorded && recorded.scans.length > 0 && <div className="aegis-review__grid">
        <div className="aegis-review__list" role="group" aria-label="Select a recorded scan">
          {recorded.scans.slice().reverse().map((scan) => <button key={scan.volume_key} type="button"
            className={selectedScan?.volume_key === scan.volume_key ? "selected" : ""}
            onClick={() => setSelectedVolume(scan.volume_key)}>
            <b>{scan.site}</b><span>{utc(scan.scan_time)}</span>
            <small>{scan.candidates.length} captured candidate{scan.candidates.length === 1 ? "" : "s"}</small>
          </button>)}
        </div>
        {selectedScan && <div className="aegis-review__detail">
          <h3>{selectedScan.site} · {utc(selectedScan.scan_time)}</h3>
          <p>Processed {utc(selectedScan.processed_at)}</p>
          <div className="aegis-review__products" aria-label="Radar product availability">
            {Object.entries(selectedScan.available_products).map(([product, available]) => <span
              key={product} className={available ? "available" : "missing"}>{product} {available ? "available" : "missing"}</span>)}
          </div>
          {selectedScan.candidates.length ? <ul className="aegis-review__candidates">
            {selectedScan.candidates.map((candidate, index) => <li key={`${candidate.warning_id || "none"}:${index}`}>
              <b>{candidate.decision.replaceAll("_", " ")}</b> · evidence score {candidate.evidence_score ?? "not assigned"}
              {candidate.warning_id && <span> · warning {candidate.warning_id}</span>}
              {candidate.factors.length > 0 && <small>{candidate.factors.join(" · ")}</small>}
            </li>)}
          </ul> : <p>No captured candidate in this scan.</p>}
          <h4>Radar limits</h4>
          <ul>{selectedScan.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
        </div>}
      </div>}
      <p className="aegis-empty">{recorded?.limitation || "Historical replay is read-only and sends no messages."}</p>
    </section>
  </div>;
}
