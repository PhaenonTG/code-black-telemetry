import { useEffect, useMemo, useRef, useState } from "react";
import { AtlasMap, type AtlasSelectedPoint } from "../../../../src/map/AtlasMap";
import { browserLocationAdapter, ipLocationAdapter, type LocationState } from "../adapters";
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

function unitLocation(location: Record<string, unknown> | null | undefined): { lat: number; lon: number } | null {
  if (!location) return null;
  const lat = Number(location.lat ?? location.latitude);
  const lon = Number(location.lon ?? location.lng ?? location.longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

export default function OpsWorkstation({ focus = "LIVE OPS" }: { focus?: string }) {
  const [gps, setGps] = useState<LocationState>({ status: "requesting" });
  const [camera, setCamera] = useState<TrafficCamera | null>(null);
  const [pinnedCameras, setPinnedCameras] = useState<TrafficCamera[]>(() => {
    try { return (JSON.parse(localStorage.getItem(CAMERA_WALL_KEY) ?? "[]") as TrafficCamera[]).slice(0, 9); } catch { return []; }
  });
  const [lowBandwidth, setLowBandwidth] = useState(() => localStorage.getItem(CAMERA_BANDWIDTH_KEY) === "true");
  const [voiceAlerts, setVoiceAlerts] = useState(() => localStorage.getItem(VOICE_ALERTS_KEY) === "true");
  const spokenAlerts = useRef(new Set<string>());
  const [selection, setSelection] = useState<Selection | null>(null);
  const [operationalItems, setOperationalItems] = useState<{ roads: RoadConditionEvent[]; reports: StormReport[] }>({ roads: [], reports: [] });
  const [nearbyUnitId, setNearbyUnitId] = useState<string>("");
  const { state: coreState, selectedPoint, selectPoint } = useCoreOps();

  useEffect(() => { localStorage.setItem(CAMERA_WALL_KEY, JSON.stringify(pinnedCameras)); }, [pinnedCameras]);
  useEffect(() => { localStorage.setItem(CAMERA_BANDWIDTH_KEY, String(lowBandwidth)); }, [lowBandwidth]);
  useEffect(() => { localStorage.setItem(VOICE_ALERTS_KEY, String(voiceAlerts)); }, [voiceAlerts]);

  const togglePinnedCamera = (value: TrafficCamera) => setPinnedCameras((current) => current.some((item) => item.id === value.id)
    ? current.filter((item) => item.id !== value.id)
    : [...current, value].slice(-9));

  useEffect(() => {
    let cancelled = false;
    void browserLocationAdapter.getCurrent().then((s) => { if (!cancelled) setGps(s); });
    const unwatch = browserLocationAdapter.watch((s) => { if (!cancelled) setGps(s); });
    return () => { cancelled = true; unwatch(); };
  }, []);
  useEffect(() => {
    const receive = (event: Event) => setOperationalItems((event as CustomEvent<{ roads: RoadConditionEvent[]; reports: StormReport[] }>).detail);
    window.addEventListener("codeblack:map-operational-update", receive);
    return () => window.removeEventListener("codeblack:map-operational-update", receive);
  }, []);

  // First landing anywhere in the app (selectedPoint is shared app-wide state) with nothing picked
  // yet defaults to the viewer's own position instead of requiring a map tap before Point
  // Inspector shows anything -- same one-shot-into-a-null-slot behavior as Storm Intel's.
  const atlasGpsForAutoSelect = toAtlasGps(gps);
  useEffect(() => {
    if (selectedPoint || !atlasGpsForAutoSelect) return;
    selectPoint({ lat: atlasGpsForAutoSelect.lat, lon: atlasGpsForAutoSelect.lon });
  }, [atlasGpsForAutoSelect, selectedPoint, selectPoint]);

  // Device GPS denied/unavailable leaves the effect above with nothing to auto-select -- fall back
  // to a coarse, IP-based approximate location instead of leaving Point Inspector permanently empty
  // until a manual map tap. Only kicks in once GPS has actually settled to denied/unavailable (not
  // while still "requesting"), so real GPS always wins the race when it's available.
  useEffect(() => {
    if (selectedPoint || atlasGpsForAutoSelect) return;
    if (gps.status !== "denied" && gps.status !== "unavailable") return;
    let cancelled = false;
    void ipLocationAdapter.getApprox().then((approx) => {
      if (cancelled || !approx) return;
      selectPoint({ lat: approx.lat, lon: approx.lon });
    });
    return () => { cancelled = true; };
  }, [gps.status, selectedPoint, atlasGpsForAutoSelect, selectPoint]);

  useEffect(() => {
    // The Radar nav destination is otherwise pixel-identical to Live Ops (same workstation, same
    // map) -- what actually earns it a separate slot is landing here with both radar layers on:
    // the wide-area mosaic for storm-scale context plus the nearest site's single-site sweep for
    // structure detail, mirroring how RadarScope/GRLevel3 users layer national + local products.
    // Only nudges layers on, never off, so a chaser who deliberately kills one mid-visit keeps it
    // off until they leave and come back.
    if (focus !== "RADAR LAB") return;
    let cancelled = false;
    void loadMapLayerVisibility().then((current) => {
      if (cancelled) return;
      if (!current.mosaic || !current.radar) {
        void saveMapLayerVisibility({ ...current, mosaic: true, radar: true });
      }
    });
    return () => { cancelled = true; };
  }, [focus]);

  useEffect(() => {
    if (focus !== "FIELD INTELLIGENCE") return;
    let cancelled = false;
    void loadMapLayerVisibility().then((current) => {
      if (!cancelled) void saveMapLayerVisibility({ ...current, roadConditions: true, trafficCameras: true, chasers: true, poi: false });
    });
    return () => { cancelled = true; };
  }, [focus]);

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
  const chaserReferences = useMemo(() => (coreState.fabric.units?.units ?? [])
    .map((unit) => ({ unit, location: unitLocation(unit.location) }))
    .filter((entry): entry is typeof entry & { location: { lat: number; lon: number } } => entry.location != null && (entry.unit.unit_type === "chase-platform" || entry.unit.role.includes("chase"))), [coreState.fabric.units]);
  useEffect(() => {
    if (!nearbyUnitId && chaserReferences.length) setNearbyUnitId(chaserReferences[0].unit.unit_id);
    else if (nearbyUnitId && !chaserReferences.some((entry) => entry.unit.unit_id === nearbyUnitId)) setNearbyUnitId(chaserReferences[0]?.unit.unit_id ?? "");
  }, [chaserReferences, nearbyUnitId]);
  const selectedChaser = chaserReferences.find((entry) => entry.unit.unit_id === nearbyUnitId) ?? null;
  // Nearby is explicitly chaser-relative. A map click still drives Storm Intel, but never silently
  // relocates gas/hotel/ER results. Fall back to this device only when no chaser position exists.
  const gpsPoint = useMemo(() => selectedChaser?.location ?? (atlasGps ? { lat: atlasGps.lat, lon: atlasGps.lon } : null), [atlasGps, selectedChaser]);
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

  return (
    <div className="ops-workstation">
      <div className="ops-map-stage">
        <AtlasMap
          gps={atlasGps}
          rangeRings="off"
          statusLines={[gpsStatusLine(gps)]}
          controlsVariant="full"
          spotters={spotters.spotters}
          showAllActiveSpotters
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
          <label className="ops-nearby-reference">
            <span>NEARBY FOR</span>
            <select value={nearbyUnitId} onChange={(event) => setNearbyUnitId(event.target.value)}>
              {chaserReferences.length === 0 && <option value="">THIS DEVICE</option>}
              {chaserReferences.map(({ unit }) => <option key={unit.unit_id} value={unit.unit_id}>{unit.operator_name || unit.display_name}</option>)}
            </select>
          </label>
          <OpsStatusPill state={coreState.stormIntel.state} label="STORM INTEL" />
          <button type="button" className={voiceAlerts ? "ops-voice-toggle active" : "ops-voice-toggle"} onClick={() => setVoiceAlerts((value) => !value)} title="Speak new tornado and flash-flood warnings">VOICE {voiceAlerts ? "ON" : "OFF"}</button>
        </div>
        {camera && <MapCameraViewer camera={camera} onClose={() => setCamera(null)} pinned={pinnedCameras.some((item) => item.id === camera.id)} onTogglePin={() => togglePinnedCamera(camera)} lowBandwidth={lowBandwidth} onLowBandwidthChange={setLowBandwidth} />}
        {selection && <MapSituationPanel selection={selection} onClose={() => setSelection(null)} />}
      </div>
      <div className="ops-side-rail">
        <CameraWall cameras={pinnedCameras} onOpen={setCamera} onRemove={(id) => setPinnedCameras((current) => current.filter((item) => item.id !== id))} />
        <IncidentTimeline alerts={alertProducts.products} roads={operationalItems.roads} reports={operationalItems.reports} onRoad={(road) => { setCamera(null); setSelection({ kind: "road", road }); }} />
        <PointInspector selectedPoint={selectedPoint} coreState={coreState} />
      </div>
    </div>
  );
}
