import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchForecast } from "../core/client";
import { useCoreOps } from "../core/useCoreOps";
import { SetupTargetMap, type SetupCandidatePoint } from "../workspaces/SetupTargetMap";
import { rankedCandidates, setupChronology } from "../workspaces/setupCandidateModel";
import "./ChaseSetups.css";

type SetupRow = {
  setup_id: string; publication_state: string; revision: number;
  valid_from: string; valid_until: string; generated_at: string;
  risk_label: string; day: number; model_status: string; review_required: boolean;
};
type SetupIndex = { status: string; checked_at?: string; last_source_check_at?: string; items: SetupRow[] };
type SetupDetail = {
  setup_id: string; publication_state: string; revision: number; generated_at: string;
  first_seen_at?: string; valid_from: string; valid_until: string; summary?: string;
  bounds?: number[];
  identity_review_required?: boolean; detected_after_baseline?: boolean;
  official: { provider?: string; day?: number; risk_label?: string; risk_code?: number; issued_at?: string; source_url?: string; geometry?: unknown };
  model: { status?: string; target_points?: Array<SetupCandidatePoint & { run_time?: string; classification?: string }>; notice?: string };
  source_checks?: { hrrr?: { status?: string; hours_checked?: number; hours_missing?: number } };
  review?: { required?: boolean; decision?: string | null; reason?: string };
};

const when = (value?: string) => {
  if (!value) return "Unavailable";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : "Unavailable";
};
const setupId = /^setup-\d{8}-[0-9a-f]{10}$/;

export default function ChaseSetups({ detailBasePath = "/chase-setups" }: { detailBasePath?: string }) {
  const { config } = useCoreOps();
  const { setupId: selectedId } = useParams();
  const navigate = useNavigate();
  const [index, setIndex] = useState<SetupIndex | null>(null);
  const [detail, setDetail] = useState<SetupDetail | null>(null);
  const [indexError, setIndexError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [selectedCandidate, setSelectedCandidate] = useState<{ setupId: string; key: string } | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setBusy(true);
    setIndexError("");
    try {
      setIndex(await fetchForecast<SetupIndex>(config, "chase-setups", signal));
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
    setDetail(null);
    setDetailError("");
    if (!selectedId) return () => controller.abort();
    if (!setupId.test(selectedId)) {
      setDetailError("Invalid setup ID.");
      return () => controller.abort();
    }
    void fetchForecast<SetupDetail>(config, `chase-setup?setup_id=${encodeURIComponent(selectedId)}`, controller.signal)
      .then((record) => { if (!controller.signal.aborted) setDetail(record); })
      .catch(() => { if (!controller.signal.aborted) setDetailError("This private draft is unavailable."); });
    return () => controller.abort();
  }, [config, selectedId, reloadVersion]);

  const rows = index?.items ?? [];
  const currentSource = index?.status === "ready";
  const points = detail?.model.target_points ?? [];
  const ranked = rankedCandidates(points);
  const selectedCandidateKey = selectedCandidate && selectedCandidate.setupId === detail?.setup_id ? selectedCandidate.key : null;
  return (
    <div className="chase-setups page">
      <header className="chase-setups__header">
        <div><h1>Chase setup drafts</h1><p>Potential setups for operator review. No draft is public.</p></div>
        <div className="chase-setups__header-actions">
          <span className={currentSource ? "chase-setups__fresh" : "chase-setups__stale"}>
            {index ? currentSource ? "Sources current" : index.status === "source_degraded" ? "Source check degraded" : "Awaiting first collection" : "Source status unavailable"}
          </span>
          <button type="button" onClick={() => { void refresh(); setReloadVersion((version) => version + 1); }} disabled={busy}>{busy ? "Checking…" : "Refresh"}</button>
        </div>
      </header>
      {indexError && <p className="chase-setups__error" role="alert">{indexError}</p>}
      <div className="chase-setups__layout">
        <section className="chase-setups__list" aria-label="Private setup drafts">
          <h2>Detected drafts <span>{rows.length}</span></h2>
          {rows.length === 0 ? <div className="chase-setups__empty">
            <strong>No setup drafts at this time</strong>
            <p>{index?.status === "ready" ? "New qualifying setups will appear after a complete source check." : "A complete source check has not produced a current draft."}</p>
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
           !selectedId ? <div className="chase-setups__empty"><strong>No setup selected</strong><p>Select a draft to inspect its evidence and review state.</p></div> :
           !detail ? <p className="chase-setups__loading">Loading private draft…</p> : <>
            <div className="chase-setups__detail-head"><div>
              <h2>Setup review</h2><p>{detail.setup_id} · Revision {detail.revision}</p>
            </div><div className="chase-setups__labels"><span>PRIVATE DRAFT</span><span>NOT A WARNING</span></div></div>
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
            <div className="chase-setups__reviews" aria-label="Advisory review status">
              <div><h3>Aegis analysis</h3><p>Not connected for chase setups yet.</p></div>
              <div><h3>Local 30B review</h3><p>Not connected for chase setups yet.</p></div>
              <div><h3>Paid second opinion</h3><p>Disabled until the sanitized one-attempt workflow is verified.</p></div>
            </div>
            <footer className="chase-setups__approval"><button type="button" disabled>Approve publication</button>
              <p>Approval is unavailable until evidence, advisory reviews, and exact-revision authorization are verified.</p></footer>
           </>}
        </article>
        <aside className="chase-setups__activity" aria-label="Draft activity">
          {detail && <section className="setup-target-area" aria-label="Setup screening area"><h2>Target area</h2><SetupTargetMap geometry={detail.official.geometry} bounds={detail.bounds} points={points} selectedKey={selectedCandidateKey} /><p>SPC area: official outlook. Gold dots: experimental HRRR screening candidates, not precise chase targets. Select a table row to focus one.</p></section>}
          <h2>Source chronology</h2>
          {detail ? <><ol className="chase-setups__chronology">{setupChronology(detail).map((entry) => <li key={entry.key}><strong>{entry.label}</strong><time dateTime={entry.at}>{when(entry.at)}</time></li>)}</ol><p>Current revision {detail.revision}. Core does not provide prior-revision evidence, so a “what changed” comparison is not available.</p></> : <p>Select a draft to inspect its source timestamps.</p>}
          <dl><div><dt>Last source check</dt><dd>{when(index?.last_source_check_at ?? index?.checked_at)}</dd></div></dl>
          <p>Official guidance remains the authority. This desk does not issue warnings.</p>
        </aside>
      </div>
    </div>
  );
}
