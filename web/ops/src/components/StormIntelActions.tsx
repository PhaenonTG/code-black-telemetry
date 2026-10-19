import type { OpsCoreState } from "../core/types";
import { firstAvailableSource } from "../stormIntel/format";

function valueOrDash(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "UNAVAILABLE" : String(value);
}

export function StormIntelActions({ coreState }: { coreState: OpsCoreState }) {
  const snapshot = coreState.stormIntel.pointSnapshot;
  const source = firstAvailableSource(snapshot);
  const selected = coreState.stormIntel.selectedPoint;
  return (
    <section className="storm-actions" aria-label="Future point workflows">
      <header>
        <span>POINT WORKFLOWS</span>
        <b>ARCHITECTURE READY</b>
      </header>
      <div className="storm-actions__grid">
        <button type="button" disabled>
          <strong>SOUNDING SNAPSHOT</strong>
          <span>Vertical profile endpoint not yet available</span>
          <small>{selected ? `${selected.lat.toFixed(4)}, ${selected.lon.toFixed(4)}` : "Select a point first"} · {valueOrDash(source?.product)} · FH {source?.forecastHour ?? "?"}</small>
        </button>
        <button type="button" disabled>
          <strong>VIEW IN CONSENSUS</strong>
          <span>Consensus remains development-only</span>
          <small>No averaging, model weights, probability, or target corridor generated.</small>
        </button>
      </div>
    </section>
  );
}
