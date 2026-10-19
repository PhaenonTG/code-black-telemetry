import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { fetchForecast } from "../core/client";
import { useCoreOps } from "../core/useCoreOps";
import { SetupTargetMap, type SetupCandidatePoint } from "../workspaces/SetupTargetMap";
import { rankedCandidates, setupChronology } from "../workspaces/setupCandidateModel";
import { SetupRevisionTimeline } from "../workspaces/SetupRevisionTimeline";
import type { SetupRevisionHistory } from "../workspaces/setupRevisionModel";
import { SetupReviewDesk } from "../workspaces/SetupReviewDesk";
import type { SetupWorkflow } from "../workspaces/setupReviewModel";
import type { WeightedSynthesis } from "../workspaces/setupReviewModel";
import { SetupSynthesis } from "../workspaces/SetupSynthesis";
import { SetupRrfsEvidence, type ModelPriority, type RrfsEvidence } from "../workspaces/SetupRrfsEvidence";
import { decisionInQueue, readSetupDecisions } from "../workspaces/chaseDay/setupReview/SetupReviewModel";
import { SetupReviewTitle } from "../workspaces/chaseDay/setupReview/SetupReviewTitle";
import { EmptyState, ErrorState, AsyncViewState } from "../components/AsyncViewState";
import { formatOpsTimestamp } from "../core/timeFormat";
import "./ChaseSetups.css";

type SetupRow = {
  setup_id: string; publication_state: string; revision: number;
  valid_from: string; valid_until: string; generated_at: string;
  risk_label: string; day: number; model_status: string; review_required: boolean;
};
type SetupIndex = { status: string; checked_at?: string; last_source_check_at?: string; items: SetupRow[] };
type SetupQueue = "drafts" | "briefings";
export type TornadoTrackingMap = {
  schema: string; status: string; boundary_source: string; source_url?: string;
  issued_at?: string; valid_from: string; valid_until: string;
  aegis_status: string; aegis_summary: string | null; numeric_point_samples: number;
  matched_numeric_fields: number; notice: string;
  setup_focus_numeric_lead: { lead_model: string; valid_time: string } | null;
  features: Array<{ type: "Feature"; geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] };
    properties: { official_risk_label: string; official_risk_code: number; tracking_state: string; numeric_model_context: boolean } }>;
};
type SetupDetail = {
  setup_id: string; publication_state: string; revision: number; generated_at: string;
  source_fingerprint?: string; workflow?: SetupWorkflow;
  weighted_synthesis?: WeightedSynthesis | null;
  tornado_tracking_map?: TornadoTrackingMap;
  model_priority?: ModelPriority;
  ingestion?: { models?: { rrfs?: RrfsEvidence } };
  current_revision?: number; is_current_revision?: boolean; revision_history?: SetupRevisionHistory;
  first_seen_at?: string; valid_from: string; valid_until: string; summary?: string;
  bounds?: number[];
  identity_review_required?: boolean; detected_after_baseline?: boolean;
  official: { provider?: string; day?: number; risk_label?: string; risk_code?: number; issued_at?: string; source_url?: string; geometry?: unknown };
  model: { status?: string; target_points?: Array<SetupCandidatePoint & { run_time?: string; classification?: string }>; notice?: string };
  source_checks?: { hrrr?: { status?: string; hours_checked?: number; hours_missing?: number } };
  review?: { required?: boolean; decision?: string | null; reason?: string };
};

const EMPTY_POINTS: SetupCandidatePoint[] = [];
const when = (value?: string) => value && Number.isFinite(Date.parse(value))
  ? <time dateTime={value} title={new Date(value).toISOString()}>{formatOpsTimestamp(value)}</time> : "\u2014";
const setupId = /^setup-\d{8}-[0-9a-f]{10}$/;

export default function ChaseSetups({ detailBasePath = "/setup-review/drafts", queue = "drafts", active = true }: { detailBasePath?: string; queue?: SetupQueue; active?: boolean }) {
  const { config } = useCoreOps();
  const { setupId: routeSelectedId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const routeRevision = searchParams.get("revision");
  const [retainedSelection, setRetainedSelection] = useState({ id: routeSelectedId, revision: routeRevision });
  if (active && (retainedSelection.id !== routeSelectedId || retainedSelection.revision !== routeRevision)) setRetainedSelection({ id: routeSelectedId, revision: routeRevision });
  const selectedId = active ? routeSelectedId : retainedSelection.id;
  const revisionParam = active ? routeRevision : retainedSelection.revision;
  const [index, setIndex] = useState<SetupIndex | null>(null);
  const [detail, setDetail] = useState<SetupDetail | null>(null);
  const [indexError, setIndexError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sourceFresh, setSourceFresh] = useState(false);
  const [queueLoading, setQueueLoading] = useState(true);
  const [decisionRows, setDecisionRows] = useState<SetupRow[] | null>(null);
  const [decisions, setDecisions] = useState<Record<string, string | null | undefined>>({});
  const [reloadVersion, setReloadVersion] = useState(0);
  const [selectedCandidate, setSelectedCandidate] = useState<{ setupId: string; key: string } | null>(null);
  const detailSelection = useRef("");

  const refresh = useCallback(async (signal?: AbortSignal, quiet = false) => {
    if (!quiet) setBusy(true);
    setIndexError("");
    try {
      const result = await fetchForecast<SetupIndex>(config, "chase-setups", signal);
      const lastSourceCheck = Date.parse(result.last_source_check_at ?? result.checked_at ?? "");
      const sourceAge = Date.now() - lastSourceCheck;
      setIndex(result);
      setDecisionRows((previous) => previous && previous.length === result.items.length && previous.every((row, position) => row.setup_id === result.items[position]?.setup_id && row.revision === result.items[position]?.revision) ? previous : result.items);
      setSourceFresh(Number.isFinite(lastSourceCheck) && sourceAge >= 0 && sourceAge <= 30 * 60_000);
    } catch {
      if (!signal?.aborted) { setIndexError(queue === "briefings" ? "Reviewed briefings are unavailable." : "Private setup drafts are unavailable. No source or review state has been inferred."); setQueueLoading(false); setSourceFresh(false); }
    } finally {
      if (!signal?.aborted && !quiet) setBusy(false);
    }
  }, [config, queue]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = window.setInterval(() => void refresh(controller.signal, true), 30_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [refresh]);

  useEffect(() => {
    if (!selectedId || !detail || revisionParam !== null || detail.is_current_revision === false) return;
    const indexedRevision = index?.items.find((row) => row.setup_id === selectedId)?.revision;
    if (indexedRevision && indexedRevision !== detail.revision) setReloadVersion((version) => version + 1);
  }, [detail, index, revisionParam, selectedId]);

  useEffect(() => {
    const controller = new AbortController();
    const items = decisionRows ?? [];
    if (!decisionRows) return () => controller.abort();
    setQueueLoading(true);
    void readSetupDecisions(config, items, controller.signal).then((entries) => {
      if (!controller.signal.aborted) {
        setDecisions(Object.fromEntries(entries));
        setQueueLoading(false);
      }
    });
    return () => controller.abort();
  }, [config, decisionRows, reloadVersion]);

  useEffect(() => {
    const controller = new AbortController();
    const selection = `${selectedId ?? ""}:${revisionParam ?? "current"}`;
    if (detailSelection.current !== selection) { setDetail(null); detailSelection.current = selection; }
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
        if (active && record.is_current_revision !== false && approved !== (queue === "briefings")) {
          navigate(`/setup-review/${approved ? "briefings" : "drafts"}/${record.setup_id}${revisionParam ? `?revision=${revisionParam}` : ""}`, { replace: true });
          return;
        }
        setDetail(record);
      })
      .catch(() => { if (!controller.signal.aborted) setDetailError(revisionParam ? "This captured revision is unavailable." : "This private draft is unavailable."); });
    return () => controller.abort();
  }, [active, config, navigate, queue, selectedId, revisionParam, reloadVersion]);

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
    if (!active || detail.is_current_revision === false) return;
    if (queue === "drafts" && workflow.decision?.decision === "approved") navigate(`/setup-review/briefings/${detail.setup_id}`, { replace: true });
    if (queue === "briefings" && workflow.decision?.decision !== "approved") navigate(`/setup-review/drafts/${detail.setup_id}`, { replace: true });
  }, [active, detail, navigate, queue]);

  const unknownRows = (index?.items ?? []).filter(row => Object.hasOwn(decisions, row.setup_id) && decisions[row.setup_id] === undefined);
  const drafts = (index?.items ?? []).filter(row => Object.hasOwn(decisions, row.setup_id) && decisionInQueue(decisions[row.setup_id], "drafts"));
  const rows = queue === "briefings" ? (index?.items ?? []).filter(row => decisionInQueue(decisions[row.setup_id], "briefings")) : drafts;
  const currentSource = index?.status === "ready" && sourceFresh;
  const isBriefings = queue === "briefings";
  const points = detail?.model.target_points ?? EMPTY_POINTS;
  const ranked = rankedCandidates(points);
  const selectedCandidateKey = selectedCandidate && selectedCandidate.setupId === detail?.setup_id ? selectedCandidate.key : null;
  return (
    <div className="chase-setups page">
      <SetupReviewTitle title={`${isBriefings ? "Briefings" : "Drafts"}${rows.length ? ` (${rows.length})` : ""}`}
        description={isBriefings ? "Approved current revisions retained as private operational briefings." : "Private drafts · operator review required. No draft is public."}
        state={indexError ? "Unavailable" : !index ? "Waiting" : currentSource ? "Live" : "Stale"}
        checkedAt={index?.last_source_check_at ?? index?.checked_at} busy={busy || queueLoading}
        refresh={() => { void refresh(); setReloadVersion(version => version + 1); }} reloads={`${queue} sources and review decisions`} />
      {indexError && <ErrorState title={isBriefings ? "Reviewed briefings are unavailable." : "Setup list unavailable"} message={indexError} onRetry={() => { void refresh(); setReloadVersion(version => version + 1); }} />}
      {unknownRows.length > 0 && <ErrorState title="Decision state unavailable" message={`${unknownRows.length} setup decision${unknownRows.length === 1 ? "" : "s"} could not be verified. These rows are excluded from both queues.`} onRetry={() => setReloadVersion(version => version + 1)} />}
      {!index && !indexError && <AsyncViewState state="loading" title="Checking review states" message="Matching each active setup to its exact operator decision." />}
      {index && !indexError && unknownRows.length === 0 && !queueLoading && rows.length === 0 && !selectedId && <EmptyState title={isBriefings ? "Briefings (0)" : "Drafts (0)"}
        message={isBriefings ? "Approving a current revision moves it here automatically." : index.status === "ready" ? "New qualifying setups will appear after a complete source check." : "A complete source check has not produced a current draft."}>
        {isBriefings && drafts.length > 0 && <a href="/setup-review/drafts">{drafts.length} drafts awaiting review →</a>}
      </EmptyState>}
      {(rows.length > 0 || selectedId) && <div className="chase-setups__layout">
        <section className="chase-setups__list" aria-label={isBriefings ? "Reviewed setup briefings" : "Private setup drafts"}>
          <ul>{rows.map(row => <li key={row.setup_id}>
            <button type="button" className={selectedId === row.setup_id ? "selected" : ""} onClick={() => navigate(`${detailBasePath}/${row.setup_id}`)}>
              <strong>SPC Day {row.day} · {row.risk_label}</strong><span>{when(row.valid_from)}–{when(row.valid_until)}</span>
              <small>{row.model_status === "available" ? "HRRR screening available" : "HRRR screening unavailable"} · Revision {row.revision}</small>
            </button>
          </li>)}</ul>
        </section>
        <article className="chase-setups__detail">
          {detailError ? <p className="chase-setups__error" role="alert">{detailError}</p> :
           !selectedId ? <div className="chase-setups__empty"><strong>No setup selected</strong><p>Select a {isBriefings ? "briefing" : "draft"} to inspect its evidence and review state.</p></div> :
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
            <SetupSynthesis synthesis={detail.weighted_synthesis} />
            <SetupRrfsEvidence key={`${detail.setup_id}:${detail.revision}`} rrfs={detail.ingestion?.models?.rrfs} priority={detail.model_priority} />
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
            <SetupReviewDesk key={`${detail.setup_id}:${detail.revision}:${reloadVersion}`} config={config}
              setupId={detail.setup_id} revision={detail.revision} fingerprint={detail.source_fingerprint}
              current={detail.is_current_revision !== false} initial={detail.workflow}
              onWorkflowChange={handleWorkflowChange} />
           </>}
        </article>
        <aside className="chase-setups__activity" aria-label={isBriefings ? "Briefing activity" : "Draft activity"}>
          {detail && <section className="setup-target-area" aria-label="Tornado potential tracking area"><h2>Tornado potential tracking</h2><SetupTargetMap geometry={detail.official.geometry} trackingMap={detail.tornado_tracking_map} bounds={detail.bounds} points={points} selectedKey={selectedCandidateKey} />
            <p>Shaded boundaries: official SPC tornado outlook. Gold dots: experimental HRRR screening candidates. Code Black does not generate these boundaries or a separate probability.</p>
            {detail.tornado_tracking_map?.status === "available" && <div className="setup-tracking-context"><strong>Code Black area review</strong><span>Aegis: {detail.tornado_tracking_map.aegis_status.replaceAll("_", " ")}</span><span>{detail.tornado_tracking_map.numeric_point_samples} numeric model point samples · {detail.tornado_tracking_map.matched_numeric_fields} matched fields</span>{detail.tornado_tracking_map.setup_focus_numeric_lead && <span>Numeric lead near setup time: {detail.tornado_tracking_map.setup_focus_numeric_lead.lead_model.toUpperCase()}</span>}{detail.tornado_tracking_map.aegis_summary && <p>{detail.tornado_tracking_map.aegis_summary}</p>}</div>}
          </section>}
          {detail && <SetupRevisionTimeline history={detail.revision_history} selectedRevision={detail.revision}
            currentRevision={detail.current_revision ?? detail.revision} onSelect={selectRevision} />}
          <h2>Source chronology</h2>
          {detail ? <><ol className="chase-setups__chronology">{setupChronology(detail).map((entry) => <li key={entry.key}><strong>{entry.label}</strong><time dateTime={entry.at}>{when(entry.at)}</time></li>)}</ol><p>Source timestamps for revision {detail.revision}.</p></> : <p>Select a {isBriefings ? "briefing" : "draft"} to inspect its source timestamps.</p>}
          <p>Official guidance remains the authority. This desk does not issue warnings.</p>
        </aside>
      </div>}
    </div>
  );
}
