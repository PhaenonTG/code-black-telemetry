import { useEffect, useMemo, useState } from "react";
import { AtlasMap, type AtlasSelectedPoint } from "../../../../src/map/AtlasMap";
import type { AtlasGpsPoint } from "../../../../src/map/types";
import { useAlertProducts } from "../../../../src/hooks/useAlertProducts";
import { useNearbyPlaces } from "../../../../src/hooks/useNearbyPlaces";
import { useNearbyPoiList } from "../../../../src/hooks/useNearbyPoiList";
import { useSpotters } from "../../../../src/hooks/useSpotters";
import { browserLocationAdapter, ipLocationAdapter, type LocationState } from "../adapters";
import { OpsStatusPill } from "../components/OpsStatusPill";
import { PointHistory } from "../components/PointHistory";
import { PointInspector } from "../components/PointInspector";
import { StormIntelMetricBoard } from "../components/StormIntelMetricBoard";
import { useCoreOps } from "../core/useCoreOps";
import { firstAvailableSource, stormIntelSummary } from "../stormIntel/format";
import { getReverseLocality, type LocalityResult } from "../../../../src/services/situational";

function toAtlasGps(s: LocationState): AtlasGpsPoint | null {
  if (s.status !== "ready") return null;
  return { lat: s.lat, lon: s.lon, accuracyM: s.accuracyM, headingDeg: s.headingDeg, speedMph: s.speedMph };
}

function coord(point: { lat: number; lon: number } | null | undefined, precision = 4): string {
  return point ? `${point.lat.toFixed(precision)}, ${point.lon.toFixed(precision)}` : "NO POINT";
}

function isoShort(value: string | null | undefined): string {
  if (!value) return "UNAVAILABLE";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "UNAVAILABLE";
  return date.toISOString().replace(".000", "");
}

export default function StormIntelWorkspace() {
  const [gps, setGps] = useState<LocationState>({ status: "requesting" });
  const [locality, setLocality] = useState<LocalityResult | null>(null);
  const { config, state: coreState, selectedPoint, pointHistory, selectPoint, selectHistoryPoint } = useCoreOps();
  const snapshot = coreState.stormIntel.pointSnapshot;
  const source = firstAvailableSource(snapshot);

  useEffect(() => {
    let cancelled = false;
    void browserLocationAdapter.getCurrent().then((s) => { if (!cancelled) setGps(s); });
    const unwatch = browserLocationAdapter.watch((s) => { if (!cancelled) setGps(s); });
    return () => { cancelled = true; unwatch(); };
  }, []);

  const atlasGps = toAtlasGps(gps);

  // First landing on Storm Intel with nothing picked yet (anywhere in the app -- selectedPoint is
  // shared app-wide state) defaults to the viewer's own position instead of an empty "select a
  // point" prompt. Only ever fires once, into a null slot -- never overrides a point the chaser
  // (or Live Ops) already selected.
  useEffect(() => {
    if (selectedPoint || !atlasGps) return;
    selectPoint({ lat: atlasGps.lat, lon: atlasGps.lon });
  }, [atlasGps, selectedPoint, selectPoint]);

  // Device GPS denied/unavailable leaves the effect above with nothing to auto-select -- fall back
  // to a coarse, IP-based approximate location instead of leaving this on "SELECT A MAP POINT"
  // until a manual tap. Only kicks in once GPS has actually settled to denied/unavailable (not
  // while still "requesting"), so real GPS always wins the race when it's available.
  useEffect(() => {
    if (selectedPoint || atlasGps) return;
    if (gps.status !== "denied" && gps.status !== "unavailable") return;
    let cancelled = false;
    void ipLocationAdapter.getApprox().then((approx) => {
      if (cancelled || !approx) return;
      selectPoint({ lat: approx.lat, lon: approx.lon });
    });
    return () => { cancelled = true; };
  }, [gps.status, selectedPoint, atlasGps, selectPoint]);

  useEffect(() => {
    if (!selectedPoint) { setLocality(null); return; }
    let cancelled = false;
    void getReverseLocality({ lat: selectedPoint.lat, lon: selectedPoint.lon }).then((result) => {
      if (!cancelled) setLocality(result);
    });
    return () => { cancelled = true; };
  }, [selectedPoint]);

  const contextPoint = useMemo(() => selectedPoint ?? (atlasGps ? { lat: atlasGps.lat, lon: atlasGps.lon } : null), [atlasGps, selectedPoint]);
  const spotters = useSpotters(contextPoint);
  const poi = useNearbyPoiList(contextPoint);
  const nearby = useNearbyPlaces(contextPoint);
  const alertProducts = useAlertProducts(contextPoint);
  const resolved = source?.resolvedLatitude != null && source.resolvedLongitude != null
    ? { lat: source.resolvedLatitude, lon: source.resolvedLongitude }
    : null;

  return (
    <div className="storm-workspace">
      <header className="storm-workspace__header">
        <div>
          <span>STORM INTEL WORKSPACE</span>
          <h1>{selectedPoint ? (locality?.displayName ?? "RESOLVING LOCATION…") : "SELECT A MAP POINT"}</h1>
          <p>{selectedPoint ? `${coord(selectedPoint, 3)} · ${stormIntelSummary(snapshot)}` : stormIntelSummary(snapshot)}</p>
        </div>
        <div className="storm-workspace__status">
          <OpsStatusPill state={coreState.stormIntel.state} label={`INTEL ${coreState.stormIntel.state}`} />
        </div>
      </header>

      <main className="storm-workspace__body">
        <section className="storm-workspace__map" aria-label="Storm Intel map selector">
          <AtlasMap
            gps={atlasGps}
            rangeRings="off"
            statusLines={[coreState.stormIntel.pointLoading ? "POINT REQUEST ACTIVE" : "CLICK MAP FOR POINT INTEL"]}
            controlsVariant="full"
            spotters={spotters.spotters}
            showAllActiveSpotters
            poiPlaces={poi.places}
            nearbyBest={nearby.places}
            alerts={alertProducts.products}
            selectedPoint={selectedPoint}
            onPointSelect={(point: AtlasSelectedPoint) => selectPoint(point)}
          />
          <div className="storm-map-command">
            <div>
              <span>REQUESTED</span>
              <b>{coord(selectedPoint)}</b>
              {selectedPoint && locality && <small>{locality.displayName}</small>}
            </div>
            <div>
              <span>RESOLVED GRID</span>
              <b>{coord(resolved)}</b>
            </div>
            <div>
              <span>VALID</span>
              <b>{isoShort(source?.validTime)}</b>
            </div>
          </div>
        </section>

        <aside className="storm-workspace__context">
          <section className="storm-provenance">
            <header>
              <span>PROVENANCE</span>
              <b>{source?.dataClass ?? snapshot?.metrics.find((metric) => metric.dataClass)?.dataClass ?? "UNAVAILABLE"}</b>
            </header>
            <dl>
              <div><dt>Requested</dt><dd>{coord(selectedPoint)}</dd></div>
              <div><dt>Location</dt><dd>{selectedPoint ? (locality?.displayName ?? "RESOLVING…") : "UNAVAILABLE"}</dd></div>
              <div><dt>Resolved grid</dt><dd>{coord(resolved)}</dd></div>
              <div><dt>Grid distance</dt><dd>{source?.gridDistanceKm != null ? `${source.gridDistanceKm.toFixed(2)} km` : "UNAVAILABLE"}</dd></div>
              <div><dt>Provider</dt><dd>{source?.provider ?? snapshot?.providerName ?? "UNAVAILABLE"}</dd></div>
              <div><dt>Model/product</dt><dd>{source?.product ?? "UNAVAILABLE"}</dd></div>
              <div><dt>Run</dt><dd>{isoShort(source?.runTime)}</dd></div>
              <div><dt>Valid</dt><dd>{isoShort(source?.validTime)}</dd></div>
              <div><dt>Forecast hour</dt><dd>{source?.forecastHour ?? "UNAVAILABLE"}</dd></div>
              <div><dt>Data class</dt><dd>{source?.dataClass ?? "UNAVAILABLE"}</dd></div>
              <div><dt>Generated</dt><dd>{isoShort(snapshot?.generatedAt)}</dd></div>
            </dl>
            {coreState.stormIntel.pointLoading && <p className="ops-loading">Loading newest selected point...</p>}
            {coreState.stormIntel.pointError && <p className="ops-error-text">{coreState.stormIntel.pointError}</p>}
            {config.mode === "SIMULATION" && <p className="ops-error-text">EXPLICIT SIMULATION MODE — NOT LIVE CORE</p>}
          </section>
          <PointHistory history={pointHistory} onSelect={selectHistoryPoint} />
        </aside>
      </main>

      <StormIntelMetricBoard coreState={coreState} />
      <PointInspector selectedPoint={selectedPoint} coreState={coreState} />
    </div>
  );
}
