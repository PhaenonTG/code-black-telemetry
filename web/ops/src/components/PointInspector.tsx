import { OpsStatusPill } from "./OpsStatusPill";
import type { OpsCoreState } from "../core/types";
import { PRIMARY_STORM_METRICS, formatMetric, metricByKey, metricProvenance, stormIntelSummary } from "../stormIntel/format";

function timeLabel(value: number | string | null | undefined) {
  if (!value) return "NO DATA";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (!Number.isFinite(date.getTime())) return "NO DATA";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function PointInspector({
  selectedPoint,
  coreState,
}: {
  selectedPoint: { lat: number; lon: number } | null;
  coreState: OpsCoreState;
}) {
  const snapshot = coreState.stormIntel.pointSnapshot;
  const units = coreState.fabric.units?.units ?? [];

  return (
    <aside className="ops-inspector" aria-label="Point and system inspector">
      <section className="ops-inspector__block ops-inspector__block--command">
        <div className="ops-inspector__eyebrow">POINT INSPECTOR</div>
        <h2>{selectedPoint ? `${selectedPoint.lat.toFixed(3)}, ${selectedPoint.lon.toFixed(3)}` : "No point selected"}</h2>
        <p>{selectedPoint ? "Map point selected. Quick Intel will use the Core Storm Intel point contract when reachable." : "Click or tap the map to stage a point-in-time weather intelligence request."}</p>
      </section>

      <section className="ops-inspector__block">
        <div className="ops-inspector__row">
          <span>Core</span>
          <OpsStatusPill state={coreState.core.state} />
        </div>
        <p>{coreState.core.detail}</p>
        <div className="ops-inspector__row">
          <span>Fabric REST</span>
          <OpsStatusPill state={coreState.fabric.state} />
        </div>
        <p>{coreState.fabric.detail}</p>
        <div className="ops-inspector__row">
          <span>Fabric WS</span>
          <b>{coreState.fabric.wsState.toUpperCase()}</b>
        </div>
        <p>Last WS event: {timeLabel(coreState.fabric.lastWsEventAt)}</p>
      </section>

      <section className="ops-inspector__block">
        <div className="ops-inspector__row">
          <span>Storm Intel</span>
          <OpsStatusPill state={coreState.stormIntel.state} />
        </div>
        <p>{coreState.stormIntel.detail}</p>
        <p>{stormIntelSummary(snapshot)}</p>
        <div className="ops-metric-stack">
          {PRIMARY_STORM_METRICS.slice(0, 8).map((key) => {
            const metric = metricByKey(snapshot, key);
            return (
              <div className="ops-metric-line" key={key}>
                <span>{metric?.label ?? key.replace(/_/g, " ").toUpperCase()}</span>
                <b>{formatMetric(metric)}</b>
                <small>{metricProvenance(metric)}</small>
              </div>
            );
          })}
        </div>
      </section>

      <section className="ops-inspector__block">
        <div className="ops-inspector__eyebrow">FLEET</div>
        {units.length === 0 ? (
          <p>No Fabric unit snapshot is available in this browser session.</p>
        ) : (
          <div className="ops-unit-list">
            {units.map((unit) => (
              <div className="ops-unit-row" key={unit.unit_id}>
                <span>{unit.operator_name || unit.display_name}</span>
                <b>{unit.overall_health}</b>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="ops-inspector__block">
        <div className="ops-inspector__eyebrow">SOUNDING SNAPSHOT</div>
        <p>Vertical profile endpoint not yet available. No Skew-T or hodograph data is fabricated in Phase 1.</p>
      </section>

      <section className="ops-inspector__block">
        <div className="ops-inspector__eyebrow">CONSENSUS</div>
        <p>Consensus chassis reserved. No model matrix, target corridor, or percentage score is generated yet.</p>
      </section>
    </aside>
  );
}
