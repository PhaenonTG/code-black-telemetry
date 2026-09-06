import type { StormIntelHistoryEntry } from "../core/types";

function zTime(value: string | null): string {
  if (!value) return "VALID ?";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "VALID ?";
  return `${date.toISOString().slice(11, 16)}Z`;
}

function localTime(value: number): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function PointHistory({
  history,
  onSelect,
}: {
  history: StormIntelHistoryEntry[];
  onSelect(entry: StormIntelHistoryEntry): void;
}) {
  return (
    <section className="point-history" aria-label="Recent Storm Intel points">
      <header>
        <span>RECENT POINTS</span>
        <b>{history.length}/12</b>
      </header>
      {history.length === 0 ? (
        <p>No point history yet. Click the map to request live Storm Intel.</p>
      ) : (
        <div className="point-history__list">
          {history.map((entry) => (
            <button type="button" key={entry.id} onClick={() => onSelect(entry)}>
              <strong>{entry.requested.lat.toFixed(3)}, {entry.requested.lon.toFixed(3)}</strong>
              <span>{entry.provider} {entry.product ?? ""} · {zTime(entry.validTime)} · FH {entry.forecastHour ?? "?"}</span>
              <small>{entry.dataClass ?? "DATA CLASS ?"} · selected {localTime(entry.selectedAt)} · reloads live point</small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
