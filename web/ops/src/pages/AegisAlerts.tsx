import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { recordedReplaySession } from "../workspaces/chaseDay/setupReview/SetupRecordedReplay";
import { OpsStatusPill } from "../components/OpsStatusPill";
import { ErrorState } from "../components/AsyncViewState";
import { formatOpsTimestamp } from "../core/timeFormat";
import { PageHeader } from "../components/PageHeader";
import { useCoreOps } from "../core/useCoreOps";
import { getAegisFeed, getAegisObservationPlan, getAegisStatus, type AegisObservationPlan,
  type AegisRadarAlert, type AegisRecordedReplay, type AegisStatus } from "../core/aegisFeed";
import { atlasStyleUri, hasMapboxToken, mapboxAccessToken } from "../../../../src/services/mapTiles";
import "../styles/aegis.css";

import { getRadarStatus, type RadarStatus } from "../../../../src/services/radar";
import { interpretRadarStatus } from "../status/externalHealth";

const REFRESH_MS = 10_000;

function when(value: string | undefined) {
  return value && Number.isFinite(Date.parse(value)) ? <time dateTime={value} title={new Date(value).toISOString()}>{formatOpsTimestamp(value)}</time> : "\u2014";
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
  const [radarStatus, setRadarStatus] = useState<RadarStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try { const next = await getRadarStatus("AUTO", "REF"); if (!cancelled) setRadarStatus(next); }
      catch { /* Keep the last radar health result; the next existing poll retries. */ }
      finally { inFlight = false; }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), REFRESH_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  const radarHealth = radarStatus ? interpretRadarStatus(radarStatus) : null;
  const [status, setStatus] = useState<AegisStatus | null>(null);
  const [plan, setPlan] = useState<AegisObservationPlan | null>(null);
  const [alerts, setAlerts] = useState<AegisRadarAlert[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // No feed conclusion ("no alerts", "shadow") is shown before Core has answered once.
  const [loaded, setLoaded] = useState(false);
  const [recorded, setRecorded] = useState<AegisRecordedReplay | null>(null);
  const [recordedError, setRecordedError] = useState<string | null>(null);
  const [selectedVolume, setSelectedVolume] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [showAll, setShowAll] = useState(false);
  const refreshFeed = useRef<(() => void) | null>(null);
  const refreshRecorded = useRef<(() => void) | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const replay = recordedReplaySession(config, controller.signal,
      result => { setRecorded(result); setRecordedError(null); }, setRecordedError);
    refreshRecorded.current = () => { void replay.refresh(); };
    const poll = async () => {
      try {
        const [, feed, observationPlan] = await Promise.all([
          getAegisStatus(config, controller.signal).then(state => {
            if (!controller.signal.aborted) { replay.status(state); setStatus(state); }
            return state;
          }),
          getAegisFeed(config, controller.signal),
          getAegisObservationPlan(config, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setNow(Date.now()); setPlan(observationPlan); setAlerts(feed.items.slice().reverse()); setError(null); setLoaded(true);
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Feed unavailable");
      }
    };
    refreshFeed.current = () => { void poll(); };
    void poll();
    const timer = window.setInterval(() => void poll(), REFRESH_MS);
    return () => { controller.abort(); refreshFeed.current = null; refreshRecorded.current = null; window.clearInterval(timer); };
  }, [config]);
  const selected = alerts.find((item) => item.id === selectedId) || alerts[0] || null;
  const selectedScan = recorded?.scans.find((scan) => scan.volume_key === selectedVolume)
    || recorded?.scans.at(-1) || null;
  return <div className="page aegis-page">
    <PageHeader routePath="/aegis-alerts" title="Aegis Alerts"
      description="Official warnings first · Aegis findings are internal. Always follow official NWS warnings; Aegis never issues or cancels one." actions={<button type="button" disabled={!status} title="Refresh the alert feed, observation plan and recorded scans" onClick={() => { refreshFeed.current?.(); refreshRecorded.current?.(); }}>Refresh</button>} />
    <div className="aegis-summary">
      <OpsStatusPill state={status ? "Live" : error ? "Unavailable" : "Waiting"} />
      <span title="Shadow mode records internal evidence; no alert messages are delivered.">{status?.delivery_enabled ? "Live delivery" : status ? "Shadow / No delivery" : "Delivery state unavailable"} <span aria-label="Shadow means internal evidence only">i</span></span>
      <span title="Minimum evidence score for an internal qualifying candidate; never a tornado probability.">Evidence cutoff i <b>{status?.screen.cutoff ?? "—"}/100</b></span>
      <span>Last screen <b>{when(status?.screen.checked_at)}</b></span>
      <span>Sites <b>{status?.screen.sites?.join(", ") || "none"}</b></span>
      <Link to="/automation-lab">Rehearse alert routing →</Link>
    </div>
    {error && <ErrorState title="Alert feed unavailable. This is not an all-clear." details={error} onRetry={() => refreshFeed.current?.()} />}
    {status?.screen.errors?.length ? <ErrorState title="Radar/source evidence unavailable" details={status.screen.errors.map(item => `${item.site}: ${item.message}`).join("; ")} onRetry={() => refreshFeed.current?.()} /> : null}
    <section className="aegis-panel aegis-observation" aria-label="Active Aegis observation plan">
      <div className="aegis-review__heading">
        <div><p className="aegis-review__kicker">CONTINUOUS SURVEILLANCE / READ-ONLY</p><h2>Active observation plan</h2></div>
        <span>{plan ? plan.executor.state.replaceAll("_", " ") : error ? "Core unavailable" : "Connecting to Core"}</span>
      </div>
      {plan ? <>
        <p className="aegis-empty">Last executor check {when(plan.executor.last_checked_at ?? undefined)} · {plan.setup_drafts.length} setup draft{plan.setup_drafts.length === 1 ? "" : "s"} under observation · {plan.live_chasers.length} live chaser{plan.live_chasers.length === 1 ? "" : "s"}.</p>
        <div className="aegis-review__products" aria-label="Observation evidence gates">
          {Object.entries(plan.gates).map(([gate, state]) => <span key={gate} className={state.includes("ready") ? "available" : "missing"}>{gate === "radar" ? "Shadow screening gate" : gate.replaceAll("_", " ")} · {state.replaceAll("_", " ")}</span>)}
          <span className={radarHealth?.state === "LIVE" ? "available" : "missing"}>radar · <OpsStatusPill state={radarHealth?.state ?? "Waiting"} /> · {radarHealth?.detail ?? "Awaiting radar health"}</span>
          <span>Shadow screening · {plan.radar?.dominant_cell?.freshness_state?.replaceAll("_", " ") || "unavailable"} · not radar health</span>
          <span className={plan.satellite?.state === "available_metadata_only" ? "available" : "missing"}>satellite · {plan.satellite?.satellite || plan.satellite?.analysis_state || "unavailable"}</span>
        </div>
        <details><summary>Source health details</summary><code>radar · {radarHealth?.state ?? "CHECKING"}</code></details>
        <p className="aegis-empty">{plan.executor.notice || "Observation evidence is recorded without routing a vehicle or issuing an official warning."}</p>
      </> : <p className="aegis-empty">{error ? "Observation plan unavailable; no current evidence has been verified." : "Loading executor, radar, satellite, and setup-surveillance state."}</p>}
    </section>
    <div className="aegis-grid">
      <section className="aegis-panel" aria-label="Aegis alert feed">
        <h2>Alert feed</h2>
        {!alerts.length && <p className="aegis-empty">{error ? "Alert feed unavailable; this is not an all-clear." : !loaded ? "Loading the Aegis alert feed…" : "No qualifying Aegis alerts in the feed. This does not mean there are no official warnings or hazards."}</p>}
        {alerts.map((item) => <button key={item.id} type="button"
          className={`aegis-alert-item${selected?.id === item.id ? " selected" : ""}`}
          onClick={() => setSelectedId(item.id)}>
          <span className="aegis-alert-item__top"><b>{item.official_warning.event}</b><span>{item.rating.evidence_score}/100 evidence</span></span>
          <span>{item.official_warning.headline}</span>
          <small>{item.radar.site} · Scan {when(item.radar.scan_time)} · Unconfirmed radar candidate</small>
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
      <p className="aegis-empty">Replay recorded scans against the live policy.</p>
      <p className="aegis-empty">These are saved screening records, not published alerts or verified tornado reports. A missing candidate is not an all-clear.</p>
      {recordedError && <ErrorState title="Recorded scans unavailable" details={recordedError} onRetry={() => refreshRecorded.current?.()} />}
      {recorded && recorded.scans.length === 0 && <p className="aegis-empty">No radar screenings have been recorded yet.</p>}
      {recorded && recorded.scans.length > 0 && <div className="aegis-review__grid">
        <div className="aegis-review__list" role="group" aria-label="Select a recorded scan">
          {recorded.scans.slice().reverse().slice(0, showAll ? 10 : 5).map((scan) => <button key={scan.volume_key} type="button"
            className={selectedScan?.volume_key === scan.volume_key ? "selected" : ""}
            onClick={() => setSelectedVolume(scan.volume_key)}>
            <b>{scan.site}</b><span>{when(scan.scan_time)}</span>
            <small>{now - Date.parse(scan.scan_time) > 24 * 3_600_000 && <>Older than 24 h · {Math.floor((now - Date.parse(scan.scan_time)) / 3_600_000)}h old · </>}{scan.candidates.length} captured candidate{scan.candidates.length === 1 ? "" : "s"}</small>
          </button>)}
          {recorded.scans.length > 5 && <button type="button" onClick={() => setShowAll(value => !value)}>{showAll ? "Show 5" : `Show all ${Math.min(10, recorded.scans.length)}`}</button>}
        </div>
        {selectedScan && <div className="aegis-review__detail">
          <h3>{selectedScan.site} · {when(selectedScan.scan_time)}</h3>
          <p>Processed {when(selectedScan.processed_at)}</p>
          <div className="aegis-review__products" aria-label="Radar product availability">
            {Object.entries(selectedScan.available_products).map(([product, available]) => <span
              key={product} className={available ? "available" : "missing"}>{product} {available ? "available" : "missing"}</span>)}
          </div>
          {selectedScan.candidates.length ? <ul className="aegis-review__candidates">
            {selectedScan.candidates.map((candidate, index) => <li key={`${candidate.warning_id || "none"}:${index}`}>
              <b title={candidate.decision === "evidence_gate_failed" ? "Required radar or warning evidence was missing; this is never an all-clear." : undefined}>{candidate.decision.replaceAll("_", " ")}{candidate.decision === "evidence_gate_failed" ? " i" : ""}</b> · evidence score {candidate.evidence_score ?? "not assigned"}
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
