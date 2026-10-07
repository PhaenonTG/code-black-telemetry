import { useEffect, useState } from "react";
import { OpsStatusPill } from "./OpsStatusPill";
import type { OpsCoreState } from "../core/types";
import { PRIMARY_STORM_METRICS, firstAvailableSource, formatMetric, metricByKey, metricThreatLevel } from "../stormIntel/format";
import { getReverseLocality, type LocalityResult } from "../../../../src/services/situational";

function timeLabel(value: number | string | null | undefined) {
  if (!value) return "NO DATA";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (!Number.isFinite(date.getTime())) return "NO DATA";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function PointInspector({
  selectedPoint,
  coreState,
  onRetry,
  onFollow,
  locationMode,
}: {
  selectedPoint: { lat: number; lon: number } | null;
  coreState: OpsCoreState;
  onRetry?: () => void;
  onFollow?: () => void;
  locationMode?: "follow" | "manual";
}) {
  const snapshot = coreState.stormIntel.pointSnapshot;
  const units = coreState.fabric.units?.units ?? [];
  const source = firstAvailableSource(snapshot);
  const location = snapshot?.context.location;

  const [locality, setLocality] = useState<LocalityResult | null>(null);
  useEffect(() => {
    if (!selectedPoint) { setLocality(null); return; }
    let cancelled = false;
    void getReverseLocality({ lat: selectedPoint.lat, lon: selectedPoint.lon }).then((result) => {
      if (!cancelled) setLocality(result);
    });
    return () => { cancelled = true; };
  }, [selectedPoint]);

  return (
    <aside className="ops-inspector" aria-label="Point and system inspector">
      <section className="ops-inspector__block ops-inspector__block--command">
        <div className="ops-inspector__eyebrow">POINT INSPECTOR</div>
        <h2>{selectedPoint ? (locality?.displayName ?? "RESOLVING LOCATION…") : "No point selected"}</h2>
        {selectedPoint && <small className="ops-inspector__coords">{selectedPoint.lat.toFixed(3)}, {selectedPoint.lon.toFixed(3)}</small>}
        <div className="ops-point-actions">
          {onFollow && <button type="button" onClick={onFollow}>My location{locationMode === "follow" ? " · following" : ""}</button>}
          {onRetry && <button type="button" disabled={!selectedPoint || coreState.stormIntel.pointLoading} onClick={onRetry}>{coreState.stormIntel.pointError ? "Retry" : "Refresh"}</button>}
        </div>
        <p>{!selectedPoint
          ? "Tap the map to request Storm Intel for a point."
          : coreState.stormIntel.pointLoading
            ? "Requesting the newest Storm Intel for this point."
            : coreState.stormIntel.pointError
              ? "The point request failed. Existing map layers remain available."
              : snapshot
                ? `Point data loaded${source?.validTime ? ` · valid ${timeLabel(source.validTime)}` : ""}.`
                : "No point data is available."}</p>
      </section>

      <section className="ops-inspector__block">
        <div className="ops-inspector__row">
          <span>Storm Intel</span>
          <OpsStatusPill state={coreState.stormIntel.state} />
        </div>
        {!coreState.stormIntel.pointLoading && <p>{coreState.stormIntel.detail}</p>}
        {coreState.stormIntel.pointLoading && <p className="ops-loading">Loading newest selected point...</p>}
        {coreState.stormIntel.pointError && <p className="ops-error-text">{coreState.stormIntel.pointError}</p>}
        {snapshot ? (
          <>
            {(coreState.stormIntel.pointLoading || coreState.stormIntel.pointError) && <p className="ops-retained-result">Previous result · {coreState.stormIntel.snapshotPoint ? `${coreState.stormIntel.snapshotPoint.lat.toFixed(3)}, ${coreState.stormIntel.snapshotPoint.lon.toFixed(3)}` : "previous location"} · valid {timeLabel(source?.validTime)}. Not a new result for the requested point.</p>}
            <div className="ops-metric-stack">
              {PRIMARY_STORM_METRICS.map((key) => {
                const metric = metricByKey(snapshot, key);
                return (
                  <div className="ops-metric-line" key={key}>
                    <span>{metric?.label ?? key.replace(/_/g, " ").toUpperCase()}</span>
                    <b data-threat={metricThreatLevel(metric)}>{formatMetric(metric)}</b>
                  </div>
                );
              })}
            </div>
            <details className="ops-provenance-details">
              <summary>Provenance</summary>
              <div className="ops-provenance-grid">
                <span>Result location</span><b>{coreState.stormIntel.snapshotPoint ? `${coreState.stormIntel.snapshotPoint.lat.toFixed(4)}, ${coreState.stormIntel.snapshotPoint.lon.toFixed(4)}` : "UNAVAILABLE"}</b>
                <span>Resolved grid</span><b>{source?.resolvedLatitude != null && source.resolvedLongitude != null ? `${source.resolvedLatitude.toFixed(4)}, ${source.resolvedLongitude.toFixed(4)}` : "UNAVAILABLE"}</b>
                <span>Grid distance</span><b>{source?.gridDistanceKm != null ? `${source.gridDistanceKm.toFixed(2)} km` : "UNAVAILABLE"}</b>
                <span>Provider</span><b>{source?.provider ?? snapshot?.providerName ?? "UNAVAILABLE"}</b>
                <span>Product</span><b>{source?.product ?? "UNAVAILABLE"}</b>
                <span>Run / valid</span><b>{source?.runTime && source.validTime ? `${new Date(source.runTime).toISOString().slice(11, 16)}Z / ${new Date(source.validTime).toISOString().slice(11, 16)}Z` : "UNAVAILABLE"}</b>
                <span>Forecast hour</span><b>{source?.forecastHour ?? "UNAVAILABLE"}</b>
                <span>Data class</span><b>{source?.dataClass ?? snapshot?.metrics.find((metric) => metric.dataClass)?.dataClass ?? "UNAVAILABLE"}</b>
                <span>Location source</span><b>{location?.resolvedFrom ?? "UNAVAILABLE"}</b>
              </div>
            </details>
          </>
        ) : (
          <p className="ops-inspector__prompt">{coreState.stormIntel.pointLoading ? "Waiting for model data. Metrics will appear when the request completes." : coreState.stormIntel.pointError ? "Retry, or select another point. No model values are being substituted." : "Tap the map to load provenance and metrics."}</p>
        )}
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
          <span>Fabric feed</span>
          <b>{coreState.fabric.streamState.toUpperCase()}</b>
        </div>
        <p>Last feed event: {timeLabel(coreState.fabric.lastStreamEventAt)}</p>
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
