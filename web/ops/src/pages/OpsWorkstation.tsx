import { useEffect, useRef, useState } from "react";
import { AtlasMap, type AtlasSelectedPoint } from "../../../../src/map/AtlasMap";
import type { LocationState } from "../adapters";
import type { AtlasGpsPoint } from "../../../../src/map/types";
import { useAlertProducts } from "../../../../src/hooks/useAlertProducts";
import { useNearbyPlaces } from "../../../../src/hooks/useNearbyPlaces";
import { useNearbyPoiList } from "../../../../src/hooks/useNearbyPoiList";
import { useSpotters } from "../../../../src/hooks/useSpotters";
import type { AlertProduct } from "../../../../src/services/situational";
import type { RoadConditionEvent, TrafficCamera } from "../../../../src/services/mapLayerModels";
import { MapCameraViewer } from "../components/MapCameraViewer";
import { CameraWall } from "../components/CameraWall";
import { IncidentTimeline } from "../components/IncidentTimeline";
import type { StormReport } from "../../../../src/services/stormReports";
import { MapSituationPanel } from "../components/MapSituationPanel";
import { PointInspector } from "../components/PointInspector";
import { useCoreOps } from "../core/useCoreOps";
import { OpsStatusPill } from "../components/OpsStatusPill";
import { loadMapLayerVisibility, saveMapLayerVisibility } from "../../../../src/services/settings";
import { mapWorkspaceVisibility, PHONE_RADAR_LAYERS, type MapWorkspace } from "../mapWorkspace";
import { useViewport } from "../hooks/useViewport";
import { PhoneSheet } from "../../../../src/components/PhoneSheet";
import type { RoutePoint } from "../../../../src/services/navigationRoute";

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
const CAMERA_WALL_KEY = "codeblack.ops.cameraWall";
const CAMERA_BANDWIDTH_KEY = "codeblack.ops.cameraSnapshotMode";
const VOICE_ALERTS_KEY = "codeblack.ops.voiceAlerts";

export default function OpsWorkstation({ focus = "LIVE OPS", onChaseDestinationSelect, routeOverlay }: { focus?: string; onChaseDestinationSelect?: (point: AtlasSelectedPoint) => void; routeOverlay?: RoutePoint[] }) {
  const phoneRadar = useViewport() === "phone" && focus === "RADAR LAB";
  const [radarVisibility, setRadarVisibility] = useState(PHONE_RADAR_LAYERS);
  const [pointOpen, setPointOpen] = useState(false);
  const [camera, setCamera] = useState<TrafficCamera | null>(null);
  const [pinnedCameras, setPinnedCameras] = useState<TrafficCamera[]>(() => {
    try { return (JSON.parse(localStorage.getItem(CAMERA_WALL_KEY) ?? "[]") as TrafficCamera[]).slice(0, 9); } catch { return []; }
  });
  const [lowBandwidth, setLowBandwidth] = useState(() => localStorage.getItem(CAMERA_BANDWIDTH_KEY) === "true");
  const [voiceAlerts, setVoiceAlerts] = useState(() => localStorage.getItem(VOICE_ALERTS_KEY) === "true");
  const spokenAlerts = useRef(new Set<string>());
  const spokenRoads = useRef(new Set<string>());
  const [selection, setSelection] = useState<Selection | null>(null);
  const [operationalItems, setOperationalItems] = useState<{ roads: RoadConditionEvent[]; reports: StormReport[] }>({ roads: [], reports: [] });
  const { state: coreState, selectedPoint, selectPoint, deviceLocation: gps, referenceLabel, referenceUnitId, referenceIsFallback, refreshPoint, followDeviceLocation, locationMode } = useCoreOps();

  useEffect(() => { localStorage.setItem(CAMERA_WALL_KEY, JSON.stringify(pinnedCameras)); }, [pinnedCameras]);
  useEffect(() => { localStorage.setItem(CAMERA_BANDWIDTH_KEY, String(lowBandwidth)); }, [lowBandwidth]);
  useEffect(() => { localStorage.setItem(VOICE_ALERTS_KEY, String(voiceAlerts)); }, [voiceAlerts]);

  const togglePinnedCamera = (value: TrafficCamera) => setPinnedCameras((current) => current.some((item) => item.id === value.id)
    ? current.filter((item) => item.id !== value.id)
    : [...current, value].slice(-9));

  useEffect(() => {
    const receive = (event: Event) => setOperationalItems((event as CustomEvent<{ roads: RoadConditionEvent[]; reports: StormReport[] }>).detail);
    window.addEventListener("codeblack:map-operational-update", receive);
    return () => window.removeEventListener("codeblack:map-operational-update", receive);
  }, []);

  useEffect(() => {
    if (phoneRadar) return;
    const workspace: MapWorkspace = focus === "RADAR LAB" ? "radar" : focus === "FIELD INTELLIGENCE" ? "field" : "operations";
    let cancelled = false;
    void loadMapLayerVisibility().then((current) => {
      if (!cancelled) void saveMapLayerVisibility(mapWorkspaceVisibility(current, workspace));
    });
    return () => { cancelled = true; };
  }, [focus, phoneRadar]);

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

  const atlasGps = locationMode === "follow" && !referenceIsFallback ? toAtlasGps(gps) : null;
  const gpsPoint = selectedPoint;
  const spotters = useSpotters(gpsPoint);
  const poi = useNearbyPoiList(gpsPoint);
  const nearby = useNearbyPlaces(gpsPoint);
  const alertProducts = useAlertProducts(gpsPoint);

  useEffect(() => {
    if (!voiceAlerts || !("speechSynthesis" in window)) return;
    for (const alert of alertProducts.products) {
      if (!/tornado warning|flash flood warning|particularly dangerous situation/i.test(`${alert.title} ${alert.headline}`) || spokenAlerts.current.has(alert.id)) continue;
      spokenAlerts.current.add(alert.id);
      const speech = new SpeechSynthesisUtterance(`${alert.title}. ${alert.area}. ${alert.insideText || alert.headline}`);
      speech.rate = 1.05; speech.pitch = 0.9; speech.volume = 1;
      window.speechSynthesis.speak(speech);
    }
  }, [alertProducts.products, voiceAlerts]);
  useEffect(() => {
    if (!voiceAlerts || !("speechSynthesis" in window)) return;
    for (const road of operationalItems.roads) {
      if (road.closureState !== "closed" || spokenRoads.current.has(road.id)) continue;
      spokenRoads.current.add(road.id);
      const speech = new SpeechSynthesisUtterance(`Route alert. Road closed. ${road.title}. ${road.roadway ?? road.description}`);
      speech.rate = 1.05; speech.pitch = 0.9; window.speechSynthesis.speak(speech);
    }
  }, [operationalItems.roads, voiceAlerts]);

  return (
    <div className={phoneRadar ? "ops-workstation ops-workstation--phone-radar" : "ops-workstation"}>
      <div className="ops-map-stage">
        <AtlasMap
          gps={atlasGps}
          referencePoint={locationMode === "manual" ? null : selectedPoint}
          referenceKey={`${locationMode}:${referenceUnitId}`}
          rangeRings="off"
          statusLines={[atlasGps ? gpsStatusLine(gps) : referenceLabel]}
          controlsVariant={phoneRadar ? "phone-radar" : "full"}
          visibility={phoneRadar ? radarVisibility : undefined}
          onVisibilityChange={phoneRadar ? setRadarVisibility : undefined}
          phoneTools={<>
            <span className="ops-radar-field">Nearby for {referenceLabel}</span>
            <button type="button" aria-pressed={voiceAlerts} onClick={() => setVoiceAlerts(value => !value)}>Voice alerts {voiceAlerts ? "on" : "off"}</button>
          </>}
          spotters={spotters.spotters}
          showAllActiveSpotters
          poiPlaces={poi.places}
          nearbyBest={nearby.places}
          alerts={alertProducts.products}
          selectedPoint={selectedPoint}
          routeOverlay={routeOverlay}
          onPointSelect={(point: AtlasSelectedPoint) => onChaseDestinationSelect ? onChaseDestinationSelect(point) : selectPoint(point)}
        />
        {!phoneRadar && <div className="ops-map-overlay ops-map-overlay--top">
          <div>
            {/* Was a "FOCUS" kicker sitting directly above this h1 -- an eyebrow labeling a
                heading that already says the same thing (the h1's own value, e.g. "OPERATIONS
                MAP", already tells you what's in focus) is a banned pattern per this project's
                design floor, and it also visually competed with sidebar card titles (POINT
                INSPECTOR, STORM INTEL) for the same small red-caps treatment, flattening the
                page/card hierarchy the critique flagged. The heading speaks for itself. */}
            <h1>{focus}</h1>
          </div>
          <div className="ops-nearby-reference">
            <span>NEARBY FOR</span>
            <strong>{referenceLabel}</strong>
          </div>
          <OpsStatusPill state={coreState.stormIntel.state} label="STORM INTEL" />
          <button type="button" className={voiceAlerts ? "ops-voice-toggle active" : "ops-voice-toggle"} onClick={() => setVoiceAlerts((value) => !value)} title="Speak new tornado and flash-flood warnings">VOICE {voiceAlerts ? "ON" : "OFF"}</button>
        </div>}
        {camera && <MapCameraViewer camera={camera} onClose={() => setCamera(null)} pinned={pinnedCameras.some((item) => item.id === camera.id)} onTogglePin={() => togglePinnedCamera(camera)} lowBandwidth={lowBandwidth} onLowBandwidthChange={setLowBandwidth} />}
        {selection && <MapSituationPanel selection={selection} onClose={() => setSelection(null)} />}
      </div>
      {phoneRadar ? <>
        <button type="button" className="ops-point-summary" aria-haspopup="dialog" onClick={() => setPointOpen(true)}><span><strong>Point details</strong><small>{coreState.stormIntel.pointLoading ? "Loading model data…" : coreState.stormIntel.pointError ? "Model data unavailable · retry" : coreState.stormIntel.pointSnapshot ? "Model data ready" : gps.status === "requesting" ? "Locating your device…" : "Choose a map point"}</small></span><span aria-hidden="true">⌄</span></button>
        <PhoneSheet open={pointOpen} title="Point details" onClose={() => setPointOpen(false)}>
          <PointInspector selectedPoint={selectedPoint} coreState={coreState} onRetry={refreshPoint} onFollow={followDeviceLocation} locationMode={locationMode} />
          {pinnedCameras.length > 0 && <CameraWall cameras={pinnedCameras} onOpen={item => { setPointOpen(false); setCamera(item); }} onRemove={id => setPinnedCameras(current => current.filter(item => item.id !== id))} />}
          {(alertProducts.products.length + operationalItems.roads.length + operationalItems.reports.length > 0) && <IncidentTimeline alerts={alertProducts.products} roads={operationalItems.roads} reports={operationalItems.reports} onRoad={road => { setPointOpen(false); setSelection({ kind: "road", road }); }} onAlert={alert => { setPointOpen(false); setSelection({ kind: "alert", alert }); }} onReport={report => selectPoint({ lat: report.lat, lon: report.lon })} />}
        </PhoneSheet>
      </> : <div className="ops-side-rail">
        <CameraWall cameras={pinnedCameras} onOpen={setCamera} onRemove={(id) => setPinnedCameras((current) => current.filter((item) => item.id !== id))} />
        <IncidentTimeline alerts={alertProducts.products} roads={operationalItems.roads} reports={operationalItems.reports} onRoad={(road) => { setCamera(null); setSelection({ kind: "road", road }); }} onAlert={(alert) => { setCamera(null); setSelection({ kind: "alert", alert }); }} onReport={(report) => selectPoint({ lat: report.lat, lon: report.lon })} />
        <PointInspector selectedPoint={selectedPoint} coreState={coreState} onRetry={refreshPoint} onFollow={followDeviceLocation} locationMode={locationMode} />
      </div>}
    </div>
  );
}
