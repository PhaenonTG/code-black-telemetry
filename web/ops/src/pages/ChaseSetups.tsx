import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { fetchForecast } from "../core/client";
import { useCoreOps } from "../core/useCoreOps";
import { SetupTargetMap, type SetupCandidatePoint } from "../workspaces/SetupTargetMap";
import { rankedCandidates, setupChronology } from "../workspaces/setupCandidateModel";
import { SetupRevisionTimeline } from "../workspaces/SetupRevisionTimeline";
import type { SetupRevisionHistory } from "../workspaces/setupRevisionModel";
import { SetupReviewDesk } from "../workspaces/SetupReviewDesk";
import type { SetupWorkflow } from "../workspaces/setupReviewModel";
import "./ChaseSetups.css";

type SetupRow = {
  setup_id: string; publication_state: string; revision: number;
  valid_from: string; valid_until: string; generated_at: string;
  risk_label: string; day: number; model_status: string; review_required: boolean;
};
type SetupIndex = { status: string; checked_at?: string; last_source_check_at?: string; items: SetupRow[] };
type SetupQueue = "drafts" | "briefings";
type SampleField = { value?: number; unit?: string };
type StormFeature = { storm_id?: string; distance_km?: number; probabilities_percent?: { ProbSevere?: number; ProbTor?: number; ProbHail?: number; ProbWind?: number } };
type ExtraEvidence = {
  status?: string; checked_at?: string;
  models?: { href?: { status?: string; hours?: Array<{ run_time?: string; valid_time?: string; points?: Array<{ fields?: Record<string, SampleField> }> }> } };
  storm_observations?: {
    probsevere?: { status?: string; observed_at?: string; points?: Array<{ features?: StormFeature[] }> };
    glm?: { status?: string; points?: Array<{ status?: string; observed_at?: string; flash_count_100km?: number; file_count?: number }> };
    wofs?: { status?: string };
  };
  advisory_evidence?: {
    official_alerts?: { status?: string; checked_at?: string; items?: Array<{ event?: string; expires_at?: string }> };
    mesoscale_discussions?: { status?: string; items?: Array<{ discussion_id?: string }> };
    storm_reports?: { status?: string; items?: Array<{ event?: string; observed_at?: string }> };
    observed_soundings?: { status?: string; station_id?: string; distance_km?: number; observed_at?: string; levels?: Array<{ pressure_hpa?: number }> };
  };
};
type SetupDetail = {
  setup_id: string; publication_state: string; revision: number; generated_at: string;
  source_fingerprint?: string; workflow?: SetupWorkflow;
  current_revision?: number; is_current_revision?: boolean; revision_history?: SetupRevisionHistory;
  first_seen_at?: string; valid_from: string; valid_until: string; summary?: string;
  bounds?: number[];
  identity_review_required?: boolean; detected_after_baseline?: boolean;
  official: { provider?: string; day?: number; risk_label?: string; risk_code?: number; issued_at?: string; source_url?: string; geometry?: unknown };
  model: { status?: string; target_points?: Array<SetupCandidatePoint & { run_time?: string; classification?: string }>; notice?: string };
  source_checks?: { hrrr?: { status?: string; hours_checked?: number; hours_missing?: number } };
  ingestion?: ExtraEvidence;
  observed_storms?: { status?: string; observed_at?: string; tracks?: Array<{ max_dbz?: number; direction_degrees?: number; speed_knots?: number }> };
  review?: { required?: boolean; decision?: string | null; reason?: string };
};

const when = (value?: string) => {
  if (!value) return "Unavailable";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : "Unavailable";
};
const setupId = /^setup-\d{8}-[0-9a-f]{10}$/;

export default function ChaseSetups({ detailBasePath = "/analysis/drafts", queue = "drafts" }: { detailBasePath?: string; queue?: SetupQueue }) {
  const { config } = useCoreOps();
  const { setupId: selectedId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const revisionParam = searchParams.get("revision");
  const [index, setIndex] = useState<SetupIndex | null>(null);
  const [detail, setDetail] = useState<SetupDetail | null>(null);
  const [indexError, setIndexError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sourceFresh, setSourceFresh] = useState(false);
  const [queueLoading, setQueueLoading] = useState(true);
  const [decisions, setDecisions] = useState<Record<string, string | null>>({});
  const [reloadVersion, setReloadVersion] = useState(0);
  const [selectedCandidate, setSelectedCandidate] = useState<{ setupId: string; key: string } | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setBusy(true);
    setIndexError("");
    try {
      const result = await fetchForecast<SetupIndex>(config, "chase-setups", signal);
      const lastSourceCheck = Date.parse(result.last_source_check_at ?? result.checked_at ?? "");
      const sourceAge = Date.now() - lastSourceCheck;
      setIndex(result);
      setSourceFresh(Number.isFinite(lastSourceCheck) && sourceAge >= 0 && sourceAge <= 30 * 60_000);
    } catch {
      if (!signal?.aborted) setIndexError("Private setup drafts are unavailable. No source or review state has been inferred.");
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }, [config]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    const items = index?.items ?? [];
    if (!index) return () => controller.abort();
    setQueueLoading(true);
    void Promise.all(items.map(async (row) => {
      try {
        const record = await fetchForecast<Pick<SetupDetail, "workflow">>(config,
          `chase-setup?setup_id=${encodeURIComponent(row.setup_id)}`, controller.signal);
        return [row.setup_id, record.workflow?.decision?.decision ?? null] as const;
      } catch {
        return [row.setup_id, null] as const;
      }
    })).then((entries) => {
      if (!controller.signal.aborted) {
        setDecisions(Object.fromEntries(entries));
        setQueueLoading(false);
      }
    });
    return () => controller.abort();
  }, [config, index]);

  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setDetailError("");
    if (!selectedId) return () => controller.abort();
    if (!setupId.test(selectedId)) {
      setDetailError("Invalid setup ID.");
      return () => controller.abort();
    }
    if (revisionParam !== null && !/^[1-9]\d{0,8}$/.test(revisionParam)) {
      setDetailError("Invalid revision number.");
      return () => controller.abort();
    }
    const query = new URLSearchParams({ setup_id: selectedId });
    if (revisionParam !== null) query.set("revision", revisionParam);
    void fetchForecast<SetupDetail>(config, `chase-setup?${query}`, controller.signal)
      .then((record) => {
        if (controller.signal.aborted) return;
        const approved = record.workflow?.decision?.decision === "approved";
        if (record.is_current_revision !== false && approved !== (queue === "briefings")) {
          navigate(`/analysis/${approved ? "briefings" : "drafts"}/${record.setup_id}${revisionParam ? `?revision=${revisionParam}` : ""}`, { replace: true });
          return;
        }
        setDetail(record);
      })
      .catch(() => { if (!controller.signal.aborted) setDetailError(revisionParam ? "This captured revision is unavailable." : "This private draft is unavailable."); });
    return () => controller.abort();
  }, [config, navigate, queue, selectedId, revisionParam, reloadVersion]);

  const selectRevision = (revision: number | null) => {
    setSearchParams((params) => {
      const next = new URLSearchParams(params);
      if (revision === null) next.delete("revision");
      else next.set("revision", String(revision));
      return next;
    });
  };

  const handleWorkflowChange = useCallback((workflow: SetupWorkflow) => {
    if (!detail) return;
    setDecisions((value) => ({ ...value, [detail.setup_id]: workflow.decision?.decision ?? null }));
    if (detail.is_current_revision === false) return;
    if (queue === "drafts" && workflow.decision?.decision === "approved") navigate(`/analysis/briefings/${detail.setup_id}`, { replace: true });
    if (queue === "briefings" && workflow.decision?.decision !== "approved") navigate(`/analysis/drafts/${detail.setup_id}`, { replace: true });
  }, [detail, navigate, queue]);

  const rows = (index?.items ?? []).filter((row) => queue === "briefings" ? decisions[row.setup_id] === "approved" : decisions[row.setup_id] !== "approved");
  const currentSource = index?.status === "ready" && sourceFresh;
  const isBriefings = queue === "briefings";
  const points = detail?.model.target_points ?? [];
  const ingestion = detail?.ingestion;
  const observations = ingestion?.status === "stale" ? undefined : ingestion?.storm_observations;
  const advisory = ingestion?.status === "stale" ? undefined : ingestion?.advisory_evidence;
  const nearestStorm = observations?.probsevere?.points?.[0]?.features?.[0];
  const glm = observations?.glm?.points?.[0];
  const href = ingestion?.status === "stale" ? undefined : ingestion?.models?.href;
  const hrefHour = href?.hours?.[0];
  const hrefFields = hrefHour?.points?.[0]?.fields;
  const probability = (field?: SampleField) => field?.unit === "%" && typeof field.value === "number" && field.value >= 0 && field.value <= 100 ? `${field.value.toFixed(1)}%` : "Unavailable";
  const ranked = rankedCandidates(points);
  const selectedCandidateKey = selectedCandidate && selectedCandidate.setupId === detail?.setup_id ? selectedCandidate.key : null;
  return (
    <div className="chase-setups page">
      <header className="chase-setups__header">
        <div><h2>{isBriefings ? "Reviewed setup briefings" : "Chase setup drafts"}</h2><p>{isBriefings ? "Approved current revisions retained as private operational briefings." : "Potential setups for operator review. No draft is public."}</p></div>
        <div className="chase-setups__header-actions">
          <span className={currentSource ? "chase-setups__fresh" : "chase-setups__stale"}>
            {index ? currentSource ? "Sources current" : index.status === "source_degraded" ? "Source check degraded" : index.status === "ready" ? "Source check stale" : "Awaiting first collection" : "Source status unavailable"}
          </span>
          <button type="button" onClick={() => { void refresh(); setReloadVersion((version) => version + 1); }} disabled={busy}>{busy ? "Checking…" : "Refresh"}</button>
        </div>
      </header>
      {indexError && <p className="chase-setups__error" role="alert">{indexError}</p>}
      <div className="chase-setups__layout">
        <section className="chase-setups__list" aria-label={isBriefings ? "Reviewed setup briefings" : "Private setup drafts"}>
          <h2>{isBriefings ? "Reviewed briefings" : "Detected drafts"} <span>{queueLoading ? "…" : rows.length}</span></h2>
          {queueLoading ? <div className="chase-setups__empty"><strong>Loading review states…</strong><p>Matching each active setup to its exact operator decision.</p></div> : rows.length === 0 ? <div className="chase-setups__empty">
            <strong>{isBriefings ? "No reviewed briefings at this time" : "No setup drafts at this time"}</strong>
            <p>{isBriefings ? "Approving a current revision moves it here automatically." : index?.status === "ready" ? "New qualifying setups will appear after a complete source check." : "A complete source check has not produced a current draft."}</p>
          </div> : <ul>{rows.map((row) => <li key={row.setup_id}>
            <button type="button" className={selectedId === row.setup_id ? "selected" : ""}
              onClick={() => navigate(`${detailBasePath}/${row.setup_id}`)}>
              <strong>SPC Day {row.day} · {row.risk_label}</strong>
              <span>{when(row.valid_from)}–{when(row.valid_until)}</span>
              <small>{row.model_status === "available" ? "HRRR screening available" : "HRRR screening unavailable"} · Revision {row.revision}</small>
            </button>
          </li>)}</ul>}
        </section>
        <article className="chase-setups__detail">
          {detailError ? <p className="chase-setups__error" role="alert">{detailError}</p> :
           !selectedId ? <div className="chase-setups__empty"><strong>No setup selected</strong><p>Select a {isBriefings ? "reviewed briefing" : "draft"} to inspect its evidence and review state.</p></div> :
           !detail ? <p className="chase-setups__loading">Loading {isBriefings ? "reviewed briefing" : "private draft"}…</p> : <>
            <div className="chase-setups__detail-head"><div>
              <h2>{isBriefings ? "Reviewed briefing" : "Setup review"}</h2><p>{detail.setup_id} · Revision {detail.revision}</p>
            </div><div className="chase-setups__labels"><span>{isBriefings ? "APPROVED REVISION" : "PRIVATE DRAFT"}</span><span>NOT A WARNING</span></div></div>
            {detail.is_current_revision === false && <div className="chase-setups__historical" role="status">
              <p>Viewing captured revision {detail.revision}. Current revision: {detail.current_revision}. The evidence and map below show this earlier draft.</p>
              <button type="button" onClick={() => selectRevision(null)}>Return to current revision</button>
            </div>}
            {detail.identity_review_required && <p className="chase-setups__error">Setup identity needs operator review before notification or publication.</p>}
            <section className="chase-setups__candidates" aria-label="Ranked experimental screening candidates">
              <div className="chase-setups__section-head"><h3>Retained screening points</h3><span>{ranked.length} shown · sorted by index</span></div>
              {ranked.length === 0 ? <p>No coordinate-bearing HRRR screening points were returned.</p> : <div className="chase-setups__table-scroll"><table><thead><tr><th scope="col">Rank</th><th scope="col">Coordinates</th><th scope="col">Valid (local)</th><th scope="col">Run (local)</th><th scope="col">Index</th><th scope="col">Classification</th></tr></thead><tbody>
                {ranked.map((point) => <tr key={point.key} className={selectedCandidateKey === point.key ? "is-selected" : ""}><td><button type="button" aria-label={`Show screening point ${point.rank} on map`} aria-pressed={selectedCandidateKey === point.key} onClick={() => setSelectedCandidate({ setupId: detail.setup_id, key: point.key })}>{point.rank} ↗</button></td><td>{point.latitude.toFixed(3)}, {point.longitude.toFixed(3)}</td><td>{when(point.valid_time)}</td><td>{when(point.run_time)}</td><td>{point.score_index.toFixed(3)}</td><td>{point.classification?.replaceAll("_", " ") ?? "Unclassified"}</td></tr>)}
              </tbody></table></div>}
              <p>Index is a model screening value, not confidence. Ranking does not identify a safe route, observed storm, or precise chase target.</p>
            </section>
            <p className="chase-setups__summary">{detail.summary}</p>
            <section className="chase-setups__evidence">
              <h3>SPC outlook <small>OFFICIAL</small></h3>
              <dl><div><dt>Risk area</dt><dd>Day {detail.official.day} · {detail.official.risk_label}</dd></div>
                <div><dt>Issued</dt><dd>{when(detail.official.issued_at)}</dd></div>
                <div><dt>Valid</dt><dd>{when(detail.valid_from)}–{when(detail.valid_until)}</dd></div></dl>
              {detail.official.source_url && <a href={detail.official.source_url} target="_blank" rel="noopener noreferrer">Open official SPC source ↗</a>}
            </section>
            <section className="chase-setups__evidence">
              <h3>HRRR screening <small>EXPERIMENTAL</small></h3>
              <p>{detail.model.status === "available" ? `${points.length} retained in-area candidate point${points.length === 1 ? "" : "s"}.` : "No current in-area screening candidate is available."}</p>
              {points.length > 0 && <p>Latest run: {when(points[0].run_time)} · Candidate valid: {when(points[0].valid_time)}</p>}
              <p>Screening indices are not probabilities, observed storm tracks, or route safety assessments.</p>
            </section>
            <section className="chase-setups__evidence" aria-label="Additional storm evidence">
              <h3>Additional storm evidence <small>INDEPENDENT SOURCES</small></h3>
              <p>Sampled at existing HRRR screening points. Source age and availability are checked independently; these products do not change target ranking.</p>
              <dl>
                <div><dt>MRMS ProbSevere · first point</dt><dd>{observations?.probsevere?.status === "available" ? `${observations.probsevere.points?.[0]?.features?.length ?? 0} nearby tracked feature(s) · ${when(observations.probsevere.observed_at)}` : "Unavailable or stale"}</dd></div>
                {nearestStorm && <div><dt>Nearest tracked feature</dt><dd>{nearestStorm.distance_km?.toFixed(1) ?? "?"} km · Severe {nearestStorm.probabilities_percent?.ProbSevere ?? "?"}% · Tor {nearestStorm.probabilities_percent?.ProbTor ?? "?"}% · Hail {nearestStorm.probabilities_percent?.ProbHail ?? "?"}% · Wind {nearestStorm.probabilities_percent?.ProbWind ?? "?"}%</dd></div>}
                <div><dt>GOES total lightning · first point</dt><dd>{glm?.status === "available" && typeof glm.flash_count_100km === "number" ? `${glm.flash_count_100km} flashes within 100 km across ${glm.file_count ?? 0} recent files · ${when(glm.observed_at)}` : "Unavailable or stale"}</dd></div>
                <div><dt>HREF ensemble · first point</dt><dd>{href?.status === "available" && hrefHour ? `Run ${when(hrefHour.run_time)} · valid ${when(hrefHour.valid_time)}` : "Unavailable or stale"}</dd></div>
                {hrefFields && <div><dt>HREF neighborhood probabilities</dt><dd>Reflectivity &gt;40 dBZ {probability(hrefFields.reflectivity_probability_40)} · Updraft helicity &gt;75 {probability(hrefFields.updraft_helicity_probability_75)} · CAPE &gt;1000 {probability(hrefFields.cape_probability_1000)} · Lightning {probability(hrefFields.lightning_probability)}</dd></div>}
                <div><dt>WoFS</dt><dd>Experimental viewer only · <a href="https://cbwofs.nssl.noaa.gov/viewer/experimental" target="_blank" rel="noopener noreferrer">Open NOAA viewer ↗</a></dd></div>
                <div><dt>NWS active alerts · sampled points</dt><dd>{advisory?.official_alerts?.status === "available" ? `${advisory.official_alerts.items?.length ?? 0} returned · checked ${when(advisory.official_alerts.checked_at)}${advisory.official_alerts.items?.length ? ` · ${advisory.official_alerts.items.map((item) => item.event).filter(Boolean).slice(0, 3).join(", ")}` : ""}` : "Unavailable or stale"}</dd></div>
                <div><dt>SPC mesoscale discussions</dt><dd>{advisory?.mesoscale_discussions?.status === "available" ? `${advisory.mesoscale_discussions.items?.length ?? 0} intersecting sampled points` : "Unavailable or stale"}</dd></div>
                <div><dt>Current radar track</dt><dd>{detail.observed_storms?.status === "current_observation_available" && detail.observed_storms.tracks?.length ? `${detail.observed_storms.tracks[0].max_dbz ?? "?"} dBZ · ${detail.observed_storms.tracks[0].direction_degrees ?? "?"}° at ${detail.observed_storms.tracks[0].speed_knots ?? "?"} kt · ${when(detail.observed_storms.observed_at)}` : "No fresh in-area track supplied"}</dd></div>
                <div><dt>Observed sounding</dt><dd>{advisory?.observed_soundings?.status === "available" ? `${advisory.observed_soundings.station_id ?? "Station unknown"} · ${advisory.observed_soundings.distance_km ?? "?"} km from sampled area · ${when(advisory.observed_soundings.observed_at)} · ${advisory.observed_soundings.levels?.length ?? 0} selected levels` : "Unavailable or stale"}</dd></div>
                <div><dt>Preliminary storm reports</dt><dd>{advisory?.storm_reports?.status === "available" ? `${advisory.storm_reports.items?.length ?? 0} nearby reports in prior 24 hours` : "Unavailable or stale"}</dd></div>
              </dl>
              <p>ProbSevere features are detected storm objects, not warnings. GLM counts total lightning, not ground strikes. HREF thresholds describe neighborhood forecast fields, not tornado probabilities. WoFS numeric guidance is not yet ingested. An empty alert, discussion, or report sample is not an all-clear; radar tracks and soundings have limited space and time coverage.</p>
            </section>
            <SetupReviewDesk key={`${detail.setup_id}:${detail.revision}:${reloadVersion}`} config={config}
              setupId={detail.setup_id} revision={detail.revision} fingerprint={detail.source_fingerprint}
              current={detail.is_current_revision !== false} initial={detail.workflow}
              onWorkflowChange={handleWorkflowChange} />
           </>}
        </article>
        <aside className="chase-setups__activity" aria-label={isBriefings ? "Briefing activity" : "Draft activity"}>
          {detail && <section className="setup-target-area" aria-label="Setup screening area"><h2>Target area</h2><SetupTargetMap geometry={detail.official.geometry} bounds={detail.bounds} points={points} selectedKey={selectedCandidateKey} /><p>SPC area: official outlook. Gold dots: experimental HRRR screening candidates, not precise chase targets. Select a table row to focus one.</p></section>}
          {detail && <SetupRevisionTimeline history={detail.revision_history} selectedRevision={detail.revision}
            currentRevision={detail.current_revision ?? detail.revision} onSelect={selectRevision} />}
          <h2>Source chronology</h2>
          {detail ? <><ol className="chase-setups__chronology">{setupChronology(detail).map((entry) => <li key={entry.key}><strong>{entry.label}</strong><time dateTime={entry.at}>{when(entry.at)}</time></li>)}</ol><p>Source timestamps for revision {detail.revision}.</p></> : <p>Select a draft to inspect its source timestamps.</p>}
          <dl><div><dt>Last source check</dt><dd>{when(index?.last_source_check_at ?? index?.checked_at)}</dd></div></dl>
          <p>Official guidance remains the authority. This desk does not issue warnings.</p>
        </aside>
      </div>
    </div>
  );
}
