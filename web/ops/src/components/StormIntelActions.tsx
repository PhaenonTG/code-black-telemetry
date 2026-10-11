import type { OpsCoreState } from "../core/types";
import { firstAvailableSource } from "../stormIntel/format";
import { useNavigate } from "react-router-dom";

function valueOrDash(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "UNAVAILABLE" : String(value);
}

export function StormIntelActions({ coreState }: { coreState: OpsCoreState }) {
  const navigate = useNavigate();
  const snapshot = coreState.stormIntel.pointSnapshot;
  const source = firstAvailableSource(snapshot);
  const selected = coreState.stormIntel.selectedPoint;
  return (
    <section className="storm-actions" aria-label="Point workflows">
      <header>
        <span>POINT WORKFLOWS</span>
        <b>CHASE TARGET READY</b>
      </header>
      <div className="storm-actions__grid">
        <button type="button" disabled>
          <strong>SOUNDING SNAPSHOT</strong>
          <span>Vertical profile endpoint not yet available</span>
          <small>{selected ? `${selected.lat.toFixed(4)}, ${selected.lon.toFixed(4)}` : "Select a point first"} · {valueOrDash(source?.product)} · FH {source?.forecastHour ?? "?"}</small>
        </button>
        <button type="button" onClick={() => navigate("/targets")} disabled={!selected}>
          <strong>OPEN CHASE TARGETS</strong>
          <span>Arm this selected point for warning-motion matching</span>
          <small>{selected ? "Review the live model context, then explicitly arm or disarm the target." : "Select a point first"}</small>
        </button>
      </div>
    </section>
  );
}
