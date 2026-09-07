import { OpsStatusPill } from "./OpsStatusPill";
import type { OpsCoreState } from "../core/types";
import { PRIMARY_STORM_METRICS, firstAvailableSource, formatMetric, metricByKey, metricProvenance, metricThreatLevel, sourceSemantics, stormIntelSummary } from "../stormIntel/format";

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
  const source = firstAvailableSource(snapshot);
  const location = snapshot?.context.location;

  return (
    <aside className="ops-inspector" aria-label="Point and system inspector">
      <section className="ops-inspector__block ops-inspector__block--command">
        <div className="ops-inspector__eyebrow">POINT INSPECTOR</div>
        <h2>{selectedPoint ? `${selectedPoint.lat.toFixed(3)}, ${selectedPoint.lon.toFixed(3)}` : "No point selected"}</h2>
        <p>{selectedPoint ? "Requesting Storm Intel for this point." : "Tap the map to request Storm Intel for a point."}</p>
      </section>

      {/* Weather content leads this panel -- Storm Intel, then the still-in-progress weather
          sections (Sounding, Consensus). System/fleet health is real information but it's not
          what a chaser opens this panel to read, so it moves to the bottom instead of pushing the
          actual weather data below the fold. */}
      <section className="ops-inspector__block">
        <div className="ops-inspector__row">
          <span>Storm Intel</span>
          <OpsStatusPill state={coreState.stormIntel.state} />
        </div>
        <p>{coreState.stormIntel.detail}</p>
        {coreState.stormIntel.pointLoading && <p className="ops-loading">Loading newest selected point...</p>}
        {coreState.stormIntel.pointError && <p className="ops-error-text">{coreState.stormIntel.pointError}</p>}
        <p>{stormIntelSummary(snapshot)}</p>
        {selectedPoint ? (
          <>
            <div className="ops-provenance-grid">
              <span>Requested</span><b>{`${selectedPoint.lat.toFixed(4)}, ${selectedPoint.lon.toFixed(4)}`}</b>
              <span>Resolved grid</span><b>{source?.resolvedLatitude != null && source.resolvedLongitude != null ? `${source.resolvedLatitude.toFixed(4)}, ${source.resolvedLongitude.toFixed(4)}` : "UNAVAILABLE"}</b>
              <span>Grid distance</span><b>{source?.gridDistanceKm != null ? `${source.gridDistanceKm.toFixed(2)} km` : "UNAVAILABLE"}</b>
              <span>Provider</span><b>{source?.provider ?? snapshot?.providerName ?? "UNAVAILABLE"}</b>
              <span>Product</span><b>{source?.product ?? "UNAVAILABLE"}</b>
              <span>Run / valid</span><b>{source?.runTime && source.validTime ? `${new Date(source.runTime).toISOString().slice(11, 16)}Z / ${new Date(source.validTime).toISOString().slice(11, 16)}Z` : "UNAVAILABLE"}</b>
              <span>Forecast hour</span><b>{source?.forecastHour ?? "UNAVAILABLE"}</b>
              <span>Data class</span><b>{source?.dataClass ?? snapshot?.metrics.find((metric) => metric.dataClass)?.dataClass ?? "UNAVAILABLE"}</b>
              <span>Location source</span><b>{location?.resolvedFrom ?? "UNAVAILABLE"}</b>
            </div>
            <div className="ops-metric-stack">
              {PRIMARY_STORM_METRICS.map((key) => {
                const metric = metricByKey(snapshot, key);
                return (
                  <div className="ops-metric-line" key={key}>
                    <span>{metric?.label ?? key.replace(/_/g, " ").toUpperCase()}</span>
                    <b data-threat={metricThreatLevel(metric)}>{formatMetric(metric)}</b>
                    <em>{sourceSemantics(metric)}</em>
                    <small>{metricProvenance(metric)}</small>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <p className="ops-inspector__prompt">Tap the map to load provenance and metrics.</p>
        )}
      </section>

      <section className="ops-inspector__block">
        <div className="ops-inspector__eyebrow">SOUNDING SNAPSHOT</div>
        <p>Vertical profile endpoint not yet available. Selected point context is ready, but no Skew-T or browser-side GRIB data is fabricated in Phase 2.</p>
      </section>

      <section className="ops-inspector__block">
        <div className="ops-inspector__eyebrow">CONSENSUS</div>
        <p>Consensus chassis reserved. No averaging, target corridor, percentage score, or tornado probability is generated in Phase 2.</p>
      </section>

      <section className="ops-inspector__block ops-inspector__block--system">
        <div className="ops-inspector__eyebrow">SYSTEM</div>
        <div className="ops-inspector__row">
          <span>Core</span>
          <OpsStatusPill state={coreState.core.state} />
        </div>
        <div className="ops-inspector__row">
          <span>Fabric REST</span>
          <OpsStatusPill state={coreState.fabric.state} />
        </div>
        <div className="ops-inspector__row">
          <span>Fabric WS</span>
          <b>{coreState.fabric.wsState.toUpperCase()}</b>
        </div>
        <p>Last WS event: {timeLabel(coreState.fabric.lastWsEventAt)}</p>
      </section>

      <section className="ops-inspector__block ops-inspector__block--system">
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
    </aside>
  );
}
