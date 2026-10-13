import { revisionChanges, type SetupRevisionHistory } from "./setupRevisionModel"

const when = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "Unavailable"

export function SetupRevisionTimeline({ history, selectedRevision, currentRevision, onSelect }: {
  history?: SetupRevisionHistory; selectedRevision: number; currentRevision: number;
  onSelect: (revision: number | null) => void;
}) {
  return <section className="setup-revisions" aria-label="Setup revision history">
    <h2>Revision history</h2>
    {!history?.entries.length ? <p>Revision history has not been captured yet. Current source timestamps are shown below.</p> : <>
      {history.earlier_evidence_unavailable && <p>History starts at revision {history.oldest_captured_revision}. Earlier evidence was not stored.</p>}
      {history.has_more && <p>Showing the latest {history.entries.length} captured revisions.</p>}
      <ol>{history.entries.map((entry) => <li key={entry.revision}>
        <button type="button" aria-pressed={selectedRevision === entry.revision}
          onClick={() => onSelect(entry.revision === currentRevision ? null : entry.revision)}>
          <strong>Revision {entry.revision}{entry.revision === currentRevision ? " · Current" : ""}</strong>
          <time dateTime={entry.captured_at}>{when(entry.captured_at)}</time>
          <span>Day {entry.day} · {entry.risk_label}</span>
          <small>{entry.candidate_count} retained HRRR points</small>
        </button>
        <div className="setup-revisions__changes">
          <span>{entry.capture_kind === "baseline" ? "Existing revision captured" : entry.compared_to_revision === null ? "First revision captured" : `Compared with revision ${entry.compared_to_revision}`}</span>
          <ul>{revisionChanges(entry).map((label) => <li key={label}>{label}</li>)}</ul>
        </div>
      </li>)}</ol>
    </>}
  </section>
}
