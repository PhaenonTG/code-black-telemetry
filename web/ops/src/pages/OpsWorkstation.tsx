import { useEffect, useMemo, useState } from "react";
import { AtlasMap, type AtlasSelectedPoint } from "../../../../src/map/AtlasMap";
import { browserLocationAdapter, type LocationState } from "../adapters";
import type { AtlasGpsPoint } from "../../../../src/map/types";
import { useAlertProducts } from "../../../../src/hooks/useAlertProducts";
import { useNearbyPlaces } from "../../../../src/hooks/useNearbyPlaces";
import { useNearbyPoiList } from "../../../../src/hooks/useNearbyPoiList";
import { useSpotters } from "../../../../src/hooks/useSpotters";
import type { AlertProduct } from "../../../../src/services/situational";
import type { RoadConditionEvent, TrafficCamera } from "../../../../src/services/mapLayerModels";
import { MapCameraViewer } from "../components/MapCameraViewer";
import { MapSituationPanel } from "../components/MapSituationPanel";
import { PointInspector } from "../components/PointInspector";
import { TimelineRail } from "../components/TimelineRail";
import { useCoreOps } from "../core/useCoreOps";
import { OpsStatusPill } from "../components/OpsStatusPill";

function toAtlasGps(s: LocationState): AtlasGpsPoint | null {
  if (s.status !== "ready") return null;
  return { lat: s.lat, lon: s.lon, accuracyM: s.accuracyM, headingDeg: s.headingDeg, speedMph: s.speedMph };
}

function gpsStatusLine(s: LocationState) {
  return s.status === "ready"
    ? `GPS LIVE - +/-${Math.round(s.accuracyM)}m`
    : s.status === "requesting"
      ? "GPS CHECKING"
      : s.status === "denied"
        ? "GPS DENIED"
        : "GPS UNAVAILABLE";
}

type Selection = { kind: "alert"; alert: AlertProduct } | { kind: "road"; road: RoadConditionEvent };

export default function OpsWorkstation({ focus = "LIVE OPS" }: { focus?: string }) {
  const [gps, setGps] = useState<LocationState>({ status: "requesting" });
  const [camera, setCamera] = useState<TrafficCamera | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const { state: coreState, selectedPoint, selectPoint } = useCoreOps();

  useEffect(() => {
    let cancelled = false;
    void browserLocationAdapter.getCurrent().then((s) => { if (!cancelled) setGps(s); });
    const unwatch = browserLocationAdapter.watch((s) => { if (!cancelled) setGps(s); });
    return () => { cancelled = true; unwatch(); };
  }, []);

  useEffect(() => {
    const cam = (e: Event) => {
      const v = (e as CustomEvent<TrafficCamera>).detail;
      if (v?.id) { setSelection(null); setCamera(v); }
    };
    const road = (e: Event) => {
      const v = (e as CustomEvent<RoadConditionEvent>).detail;
      if (v?.id) { setCamera(null); setSelection({ kind: "road", road: v }); }
    };
    const alert = (e: Event) => {
      const v = (e as CustomEvent<AlertProduct>).detail;
      if (v?.id) { setCamera(null); setSelection({ kind: "alert", alert: v }); }
    };
    window.addEventListener("codeblack:map-camera-open", cam);
    window.addEventListener("codeblack:map-road-open", road);
    window.addEventListener("codeblack:map-alert-open", alert);
    return () => {
      window.removeEventListener("codeblack:map-camera-open", cam);
      window.removeEventListener("codeblack:map-road-open", road);
      window.removeEventListener("codeblack:map-alert-open", alert);
    };
  }, []);

  const atlasGps = toAtlasGps(gps);
  const gpsPoint = useMemo(() => (atlasGps ? { lat: atlasGps.lat, lon: atlasGps.lon } : selectedPoint), [atlasGps, selectedPoint]);
  const spotters = useSpotters(gpsPoint);
  const poi = useNearbyPoiList(gpsPoint);
  const nearby = useNearbyPlaces(gpsPoint);
  const alertProducts = useAlertProducts(gpsPoint);

  return (
    <div className="ops-workstation">
      <div className="ops-map-stage">
        <AtlasMap
          gps={atlasGps}
          rangeRings="off"
          statusLines={[gpsStatusLine(gps)]}
          controlsVariant="full"
          spotters={spotters.spotters}
          poiPlaces={poi.places}
          nearbyBest={nearby.places}
          alerts={alertProducts.products}
          selectedPoint={selectedPoint}
          onPointSelect={(point: AtlasSelectedPoint) => selectPoint(point)}
        />
        <div className="ops-map-overlay ops-map-overlay--top">
          <div>
            <span>FOCUS</span>
            <b>{focus}</b>
          </div>
          <OpsStatusPill state={coreState.stormIntel.state} label="STORM INTEL" />
        </div>
        <TimelineRail />
        {camera && <MapCameraViewer camera={camera} onClose={() => setCamera(null)} />}
        {selection && <MapSituationPanel selection={selection} onClose={() => setSelection(null)} />}
      </div>
      <PointInspector selectedPoint={selectedPoint} coreState={coreState} />
    </div>
  );
}
