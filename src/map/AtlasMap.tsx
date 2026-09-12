import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { atlasStyleUri, hasMapboxToken, mapboxAccessToken, writeMapRuntimeDiagnostics } from "../services/mapTiles";
import type { AlertProduct } from "../services/situational";
import type { Spotter } from "../services/spotters";
import type { NearbyCategory, NearbyPlace } from "../services/nearby";
import { resolveTeamPositions } from "../services/teamPositions";
import { clearBreadcrumbTrail } from "../services/breadcrumbTrail";
import { downloadBreadcrumbExport } from "../services/breadcrumbExport";
import { DEFAULT_CHASER_RADIUS_MILES, getMapLayerVisibility, loadChaserRadiusMiles, loadMapLayerVisibility, subscribeChaserRadiusMiles, subscribeMapLayerVisibility, saveMapLayerVisibility } from "../services/settings";
import { getChaserNetMembersForViewport, getChaserNetReportsForViewport, type ChaserNetMapMember, type ChaserNetReport } from "../services/chaserNet";
import { useBreadcrumbTrail } from "../hooks/useBreadcrumbTrail";
import { useTeamRoster } from "../hooks/useTeamRoster";
import { useCustomPoiPins } from "../hooks/useCustomPoiPins";
import { useChaserPinStyle, useTeamPinStyle, useVehicleMarkerStyle } from "../hooks/usePinStyle";
import { applyAtlasCamera, zoomForSpeed } from "./AtlasCameraController";
import { atlasLifecycleCounters, atlasMapInstanceCount, decrementAtlasMapInstances, incrementAtlasCounter, incrementAtlasMapInstances, writeAtlasDiagnostics } from "./AtlasDiagnostics";
import { ATLAS_ALERTS_FILL_LAYER, ATLAS_ALERTS_LINE_LAYER, updateAtlasAlertsLayer } from "./AtlasAlertsLayer";
import { updateAtlasBreadcrumbLayer } from "./AtlasBreadcrumbLayer";
import { chaserNetReportToMapPoint, updateAtlasChaserNetLayer, updateAtlasChaserNetReportLayer } from "./AtlasChaserNetLayer";
import { startAtlasMosaicLayer, type MosaicStatus } from "./AtlasMosaicLayer";
import { updateAtlasPoiLayer } from "./AtlasPoiLayer";
import { atlasRadarLayerId, removeAtlasRadarLayer, updateAtlasRadarLayer } from "./AtlasRadarLayer";
import { updateAtlasRangeRings } from "./AtlasRangeRingLayer";
import { updateAtlasRoadConditionLayer } from "./AtlasRoadLayer";
import { updateAtlasRoadLineLayer } from "./AtlasRoadLineLayer";
import { updateAtlasSpotterLayer } from "./AtlasSpotterLayer";
import { tuneAtlasStyle } from "./AtlasStyleManager";
import { updateAtlasTeamLayer } from "./AtlasTeamLayer";
import { updateAtlasTrafficCameraLayer } from "./AtlasTrafficCameraLayer";
import { updateAtlasSurfaceStationLayer } from "./AtlasSurfaceStationLayer";
import { updateAtlasStormReportLayer } from "./AtlasStormReportLayer";
import { updateAtlasRiverGaugeLayer } from "./AtlasRiverGaugeLayer";
import { updateAtlasNavigationRouteLayer } from "./AtlasNavigationRouteLayer";
import { updateAtlasVehicleLayer } from "./AtlasVehicleLayer";
import { ATLAS_WATCHES_FILL_LAYER, ATLAS_WATCHES_LINE_LAYER, updateAtlasWatchesLayer } from "./AtlasWatchesLayer";
import type { AtlasCameraMode, AtlasGpsPoint, AtlasMapState, AtlasRangeRingMode } from "./types";
import { clusterViewportPoints, filterViewportPoints, viewportFromMap, zoomDetailLevel, type MapViewport } from "./viewport";
import { getActiveWatchPolygons, type WatchPolygon } from "../services/watches";
import { getRoadConditionsForViewport, getTrafficCamerasForViewport, getSurfaceStationsForViewport, type RoadConditionEvent, type TrafficCamera, type SurfaceStationObservation, type ViewportLayerResult } from "../services/mapLayerModels";
import { roadProvidersForViewport, trafficCameraProvidersForViewport } from "../services/roadCameraProviders";
import { ageText, getNearestRadarSites, getRadarFrames, getStormMotionEstimate, radarWorkerMissingOnWeb, setRadarStormMotion, type RadarFrame, type RadarProduct, type RadarSite, type StormMotion } from "../services/radar";
import { useWind } from "../hooks/useTelemetry";
import { AtlasRadarLegend, radarSwatchCss } from "./AtlasRadarLegend";
import { normalizeRadarFrames, nextPlaybackIndex, playbackDelayMs } from "../services/radarLoop";
import { radarFailoverReason, radarFramesAreOperational } from "../services/radarFailover";
import { LayerGlyph } from "../components/situational/LayerGlyph";
import { getNearbyStormReports, type StormReport } from "../services/stormReports";
import { getRiverGaugesForViewport, type RiverGaugeObservation } from "../services/riverGaugeProvider";
import { fetchNavigationRoute, type RoutePoint } from "../services/navigationRoute";

const RADAR_REFRESH_MS = 90_000; // Poll the worker for a fresher scan well inside NEXRAD's ~4-6 min
// volume-scan cadence, without hammering it every render.
const RADAR_LOOP_FRAME_COUNT = 12; // "Last so many frames" loop depth -- long enough to show real
// storm motion, short enough that a slow worker/connection doesn't stall the toggle for ages.
const RADAR_SITE_OVERRIDE_KEY = "codeblack.radar.siteOverride";

const INTRO_START_ZOOM = 4.5; // Wide establishing shot -- the initial flyTo (below) eases down to
// the real operating zoom for a "swoop to position" open on cold launch, rather than snapping.
const INTRO_DURATION_MS = 2800;
const WATCHES_REFRESH_MS = 5 * 60_000; // Watches are issued/canceled far less often than radar
// updates, but a new one mid-chase matters -- 5 min keeps this current without hammering NWS's
// service.
// Owner-specified: manually moving the map pauses auto-follow for 2 minutes, then resumes on its
// own -- long enough to actually look at something without fighting the vehicle's own movement,
// short enough that walking away doesn't strand the map wherever it was left.
const INTERACTION_PAUSE_MS = 2 * 60_000;

function bearingTo(from: { lat: number; lon: number }, to: { lat: number; lon: number }) {
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;
  const deltaLon = (to.lon - from.lon) * Math.PI / 180;
  return (Math.atan2(Math.sin(deltaLon) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon)) * 180 / Math.PI + 360) % 360;
}

function milesBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const latMiles = (b.lat - a.lat) * 69;
  const lonMiles = (b.lon - a.lon) * 69 * Math.cos(a.lat * Math.PI / 180);
  return Math.hypot(latMiles, lonMiles);
}

function inRouteAheadCorridor(point: { lat: number; lon: number }, gps: AtlasGpsPoint | null) {
  if (!gps) return true;
  const distance = milesBetween(gps, point);
  if (distance <= 4) return true;
  if (distance > 20 || gps.headingDeg == null) return false;
  const delta = Math.abs(((bearingTo(gps, point) - gps.headingDeg + 540) % 360) - 180);
  return delta <= 55;
}

function distanceToRouteMiles(point: { lat: number; lon: number }, route: RoutePoint[]) {
  let best = Number.POSITIVE_INFINITY;
  const scale = Math.cos(point.lat * Math.PI / 180);
  for (let index = 1; index < route.length; index += 1) {
    const a = route[index - 1]; const b = route[index];
    const ax = (a.lon - point.lon) * 69 * scale; const ay = (a.lat - point.lat) * 69;
    const bx = (b.lon - point.lon) * 69 * scale; const by = (b.lat - point.lat) * 69;
    const dx = bx - ax; const dy = by - ay; const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

type AtlasMapProps = {
  gps: AtlasGpsPoint | null;
  expanded?: boolean;
  // Weather-compact and Locate-full both stay mounted at once (swipeable pager keeps every page
  // alive so switching is instant) -- without this, the page you're NOT looking at still runs a
  // full pulse rAF loop, mosaic frame-swap ticks, and camera easeTo on every GPS update, fighting
  // the visible instance for GPU/main-thread time. That contention is what read as "choppy pulse"
  // and "zoom jumping between two values" -- not a single bad animation, but two live WebGL maps
  // competing for frames. `active` pauses the continuous/expensive work on whichever instance isn't
  // currently on screen; position data (vehicle marker, breadcrumb) still updates so there's no
  // stale-catch-up animation when you swipe back.
  active?: boolean;
  rangeRings: AtlasRangeRingMode;
  onOpenExpanded?: () => void;
  statusLines: string[];
  alerts?: AlertProduct[];
  spotters?: Spotter[];
  showAllActiveSpotters?: boolean;
  poiPlaces?: NearbyPlace[];
  nearbyBest?: Partial<Record<NearbyCategory, NearbyPlace>>;
  // "compact" is the Weather-page card: owner asked for mosaic + layer visibility only, no zoom/
  // north-up/rings/clear-trail/mosaic-toggle buttons and no single-site radar UI at all -- that
  // full toolbar only exists on the "full" Locate page, which has the room for it.
  controlsVariant?: "full" | "compact";
  escapeControl?: ReactNode;
  selectedPoint?: AtlasSelectedPoint | null;
  onPointSelect?: (point: AtlasSelectedPoint) => void;
};

export interface AtlasSelectedPoint {
  lat: number;
  lon: number;
}

const EMPTY_MODIFIERS = { modifiedLayers: 0, firstSymbolLayerId: undefined as string | undefined, lastMapError: "" };
const SELECTED_POINT_SOURCE_ID = "codeblack-selected-point-source";
const SELECTED_POINT_RING_LAYER_ID = "codeblack-selected-point-ring";
const SELECTED_POINT_CORE_LAYER_ID = "codeblack-selected-point-core";
// Stable references for the default-prop case -- a fresh `[]` literal in the destructured default
// would otherwise be recreated on every render, changing identity and re-firing every effect keyed
// off `alerts`/`spotters` even though nothing actually changed.
const EMPTY_ALERTS: AlertProduct[] = [];
const EMPTY_SPOTTERS: Spotter[] = [];
const EMPTY_POI: NearbyPlace[] = [];
const EMPTY_NEARBY_BEST: Partial<Record<NearbyCategory, NearbyPlace>> = {};
const ATLAS_STYLE_TUNING_DISABLED = import.meta.env.VITE_ATLAS_DISABLE_STYLE_TUNE === "1";
const ATLAS_DIAGNOSTICS_ENABLED = import.meta.env.VITE_ATLAS_DIAGNOSTICS === "1";
const GPS_REFRESH_MAX_AGE_MS = 5_000;
const GPS_MIN_MOVE_METERS = 4;
const GPS_MIN_HEADING_DEG = 5;
const GPS_MIN_SPEED_MPH = 1;
const GPS_MIN_ACCURACY_M = 5;

function metersBetween(a: AtlasGpsPoint, b: AtlasGpsPoint) {
  const metersPerDegreeLat = 111_320;
  const meanLat = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const dLat = (b.lat - a.lat) * metersPerDegreeLat;
  const dLon = (b.lon - a.lon) * metersPerDegreeLat * Math.cos(meanLat);
  return Math.hypot(dLat, dLon);
}

function headingDelta(a: number | null | undefined, b: number | null | undefined) {
  if (a == null || b == null) return a === b ? 0 : 360;
  const delta = Math.abs((((b - a) % 360) + 540) % 360 - 180);
  return Number.isFinite(delta) ? delta : 360;
}

function shouldApplyGpsUpdate(previous: { gps: AtlasGpsPoint; at: number } | null, gps: AtlasGpsPoint, now: number) {
  if (!previous) return true;
  if (now - previous.at >= GPS_REFRESH_MAX_AGE_MS) return true;
  if (metersBetween(previous.gps, gps) >= GPS_MIN_MOVE_METERS) return true;
  if (headingDelta(previous.gps.headingDeg, gps.headingDeg) >= GPS_MIN_HEADING_DEG && (gps.speedMph ?? 0) >= 3) return true;
  if (Math.abs((previous.gps.speedMph ?? 0) - (gps.speedMph ?? 0)) >= GPS_MIN_SPEED_MPH) return true;
  if (Math.abs((previous.gps.accuracyM ?? 0) - (gps.accuracyM ?? 0)) >= GPS_MIN_ACCURACY_M) return true;
  return false;
}

function updateAtlasSelectedPoint(map: mapboxgl.Map, point: AtlasSelectedPoint | null) {
  if (!map.isStyleLoaded()) return;
  const data = {
    type: "FeatureCollection",
    features: point
      ? [{
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [point.lon, point.lat] },
      }]
      : [],
  } as const;
  const existing = map.getSource(SELECTED_POINT_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
  if (existing) {
    existing.setData(data);
  } else {
    map.addSource(SELECTED_POINT_SOURCE_ID, { type: "geojson", data });
  }
  if (!map.getLayer(SELECTED_POINT_RING_LAYER_ID)) {
    map.addLayer({
      id: SELECTED_POINT_RING_LAYER_ID,
      type: "circle",
      source: SELECTED_POINT_SOURCE_ID,
      paint: {
        "circle-radius": 13,
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": "#FF2A0C",
        "circle-stroke-width": 2,
        "circle-opacity": 0.95,
      },
    });
  }
  if (!map.getLayer(SELECTED_POINT_CORE_LAYER_ID)) {
    map.addLayer({
      id: SELECTED_POINT_CORE_LAYER_ID,
      type: "circle",
      source: SELECTED_POINT_SOURCE_ID,
      paint: {
        "circle-radius": 4,
        "circle-color": "#FFFFFF",
        "circle-stroke-color": "#000000",
        "circle-stroke-width": 1,
      },
    });
  }
}

export function AtlasMap({
  gps,
  expanded = false,
  active = true,
  rangeRings,
  onOpenExpanded,
  statusLines,
  alerts = EMPTY_ALERTS,
  spotters = EMPTY_SPOTTERS,
  showAllActiveSpotters = false,
  poiPlaces = EMPTY_POI,
  nearbyBest = EMPTY_NEARBY_BEST,
  controlsVariant = "full",
  escapeControl,
  selectedPoint = null,
  onPointSelect,
}: AtlasMapProps) {
  const compact = controlsVariant === "compact";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const styleInfoRef = useRef(EMPTY_MODIFIERS);
  const styleInitializedRef = useRef(false);
  // Whether the one-time cinematic wide-to-operating-zoom intro has fired for this map instance.
  // Kept separate from styleInitializedRef because the two are gated on different, independently-
  // arriving conditions (map style loaded vs. first real GPS fix) -- see the dedicated intro effect
  // below for why they can't share one gate.
  const introAppliedRef = useRef(false);
  const latestRef = useRef({ gps, rangeRings, expanded });
  const onPointSelectRef = useRef(onPointSelect);
  onPointSelectRef.current = onPointSelect;
  const [cameraMode, setCameraMode] = useState<AtlasCameraMode>("FOLLOW_NORTH");
  const [bearing, setBearing] = useState(gps?.headingDeg ?? 0);
  const [pitch, setPitch] = useState(0);
  // Speed-aware zoom (AtlasCameraController.zoomForSpeed) re-zooms the camera every time GPS speed
  // crosses one of its bands -- useful hands-off, but disorienting when you deliberately zoomed in
  // on something and don't want the next speed change to yank it back out. Session-only (not
  // persisted), same as cameraMode itself.
  const [zoomLocked, setZoomLocked] = useState(false);
  const zoomLockedRef = useRef(zoomLocked);
  zoomLockedRef.current = zoomLocked;
  const [mapError, setMapError] = useState("");
  const [mapState, setMapState] = useState<AtlasMapState>("INITIALIZING");
  const [renderCount, setRenderCount] = useState(0);
  const [idleCount, setIdleCount] = useState(0);
  const [pixelSample, setPixelSample] = useState("pending");
  const renderCountRef = useRef(0);
  const idleCountRef = useRef(0);
  const lastGpsAppliedRef = useRef<{ gps: AtlasGpsPoint; at: number } | null>(null);
  const stopMosaicRef = useRef<(() => void) | null>(null);
  // Manual pan/zoom/rotate pauses auto-follow and the mosaic loop rather than fighting the user's
  // own drag -- Infinity while actively interacting (never "expires" mid-gesture), a real
  // timestamp once they let go so both this component and the mosaic loop can check "are we still
  // in the post-interaction cooldown" without needing interaction state threaded through props.
  const interactionResumeAtRef = useRef(0);
  const interactionResumeTimerRef = useRef<number | null>(null);
  const autoModeRef = useRef<AtlasCameraMode>("FOLLOW_NORTH");
  const [loaded, setLoaded] = useState(false);
  const styleUri = atlasStyleUri();
  const trail = useBreadcrumbTrail();
  // Was 5 separate local useState flags (one per layer) until the full-page Layer Config screen
  // needed to control the same toggles from outside either AtlasMap instance -- moved to the
  // shared get/save/subscribe store in services/settings.ts so the Weather page's compact map, the
  // Locate page's full map, and the new config screen all read/write the exact same state instead
  // of each map instance keeping its own independent (and previously non-persisted) copy.
  const [layerVisibility, setLayerVisibility] = useState({ warnings: true, watches: true, mesoscaleDiscussions: true, specialStatements: true, team: true, chasers: true, poi: true, mosaic: true, radar: false, roadConditions: false, trafficCameras: false, surfaceStations: false, stormReports: true, riverGauges: false, probes: false, chaserNet: false, breadcrumbs: true });
  useEffect(() => {
    const unsubscribe = subscribeMapLayerVisibility(setLayerVisibility);
    void loadMapLayerVisibility();
    return () => { unsubscribe(); };
  }, []);
  useEffect(() => {
    const close = () => setLayersPopoverOpen(false);
    window.addEventListener("codeblack:close-map-popovers", close);
    return () => window.removeEventListener("codeblack:close-map-popovers", close);
  }, []);
  const { warnings: warningsVisible, watches: watchesVisible, mesoscaleDiscussions: mesoscaleDiscussionsVisible, specialStatements: specialStatementsVisible, team: teamVisible, chasers: chasersVisible, poi: poiVisible, mosaic: mosaicVisible, radar: radarVisible, roadConditions: roadConditionsVisible, trafficCameras: trafficCamerasVisible, surfaceStations: surfaceStationsVisible, stormReports: stormReportsVisible, riverGauges: riverGaugesVisible, breadcrumbs: breadcrumbsVisible, chaserNet: chaserNetVisible } = layerVisibility;
  const toggleLayer = (key: keyof typeof layerVisibility) => {
    const current = getMapLayerVisibility();
    void saveMapLayerVisibility({ ...current, [key]: !current[key] });
  };
  const applyLayerPreset = (preset: "intercept" | "travel" | "flood" | "night" | "low-bandwidth") => {
    const current = getMapLayerVisibility();
    const common = { ...current, warnings: true, watches: true, mosaic: true, poi: false };
    const next = preset === "intercept"
      ? { ...common, mesoscaleDiscussions: true, specialStatements: true, chasers: true, roadConditions: true, trafficCameras: true, surfaceStations: true, stormReports: true }
      : preset === "travel"
        ? { ...common, mesoscaleDiscussions: false, specialStatements: true, chasers: false, roadConditions: true, trafficCameras: true, surfaceStations: false }
        : preset === "flood"
          ? { ...common, mesoscaleDiscussions: false, specialStatements: true, chasers: false, roadConditions: true, trafficCameras: true, surfaceStations: true, stormReports: true, riverGauges: true }
          : preset === "night"
            ? { ...common, mesoscaleDiscussions: true, specialStatements: true, chasers: true, roadConditions: true, trafficCameras: true, surfaceStations: true }
            : { ...common, mesoscaleDiscussions: false, specialStatements: false, chasers: true, roadConditions: true, trafficCameras: false, surfaceStations: false, radar: false };
    void saveMapLayerVisibility(next);
  };
  const mosaicVisibleRef = useRef(mosaicVisible);
  mosaicVisibleRef.current = mosaicVisible;
  const [watches, setWatches] = useState<WatchPolygon[]>([]);
  const [chaserNetMembers, setChaserNetMembers] = useState<ChaserNetMapMember[]>([]);
  const [chaserNetReports, setChaserNetReports] = useState<ChaserNetReport[]>([]);
  const [roadConditions, setRoadConditions] = useState<RoadConditionEvent[]>([]);
  const [trafficCameras, setTrafficCameras] = useState<TrafficCamera[]>([]);
  const [surfaceStations, setSurfaceStations] = useState<SurfaceStationObservation[]>([]);
  const [stormReports, setStormReports] = useState<StormReport[]>([]);
  const [riverGauges, setRiverGauges] = useState<RiverGaugeObservation[]>([]);
  const [roadLayerStatus, setRoadLayerStatus] = useState<ViewportLayerResult<RoadConditionEvent>["status"]>("not-configured");
  const [cameraLayerStatus, setCameraLayerStatus] = useState<ViewportLayerResult<TrafficCamera>["status"]>("not-configured");
  const [surfaceStationLayerStatus, setSurfaceStationLayerStatus] = useState<ViewportLayerResult<SurfaceStationObservation>["status"]>("not-configured");
  const [mosaicStatus, setMosaicStatus] = useState<MosaicStatus>("loading");
  const [layersPopoverOpen, setLayersPopoverOpen] = useState(false);
  const [routeAheadOnly, setRouteAheadOnly] = useState(false);
  const [navigationRoute, setNavigationRoute] = useState<RoutePoint[]>([]);
  const [viewport, setViewport] = useState<MapViewport | null>(null);
  // Live vehicle mesonet wind, surfaced next to the radar instrument so a chaser can correlate
  // "what the truck is feeling right now" against "what SRV shows the storm doing" -- the actual
  // differentiator over a generic radar app, not something any of RadarScope/GR2Analyst can show.
  const vehicleWind = useWind();
  const roster = useTeamRoster();
  const teamPinStyle = useTeamPinStyle();
  const chaserPinStyle = useChaserPinStyle();
  const vehicleMarkerStyle = useVehicleMarkerStyle();
  const vehicleMarkerStyleRef = useRef(vehicleMarkerStyle);
  vehicleMarkerStyleRef.current = vehicleMarkerStyle;
  const activeRef = useRef(active);
  activeRef.current = active;
  const [chaserRadiusMiles, setChaserRadiusMiles] = useState(DEFAULT_CHASER_RADIUS_MILES);
  useEffect(() => {
    const unsubscribe = subscribeChaserRadiusMiles(setChaserRadiusMiles);
    void loadChaserRadiusMiles();
    return () => { unsubscribe(); };
  }, []);
  const customPoiPins = useCustomPoiPins();
  const teamPositions = useMemo(() => resolveTeamPositions(spotters, roster), [spotters, roster]);
  const chaserSpotters = useMemo(() => {
    const teamIds = new Set(teamPositions.map((member) => member.id));
    // Team is a small, deliberately-curated roster -- always shown regardless of distance. Chasers
    // is the raw nationwide Spotter Network feed with no server-side radius filter, so without this
    // bound every active spotter in the country renders as a pin, burying everything else on the map
    // (including the watch/warning polygons underneath) once you zoom out even slightly.
    return spotters.filter((spotter) => !teamIds.has(spotter.id) && (showAllActiveSpotters || spotter.distanceMiles <= chaserRadiusMiles));
  }, [spotters, teamPositions, chaserRadiusMiles, showAllActiveSpotters]);
  const visibleTeamPositions = useMemo(() => (viewport ? filterViewportPoints(teamPositions, viewport) : teamPositions), [teamPositions, viewport]);
  const visibleChaserSpotters = useMemo(() => (viewport ? filterViewportPoints(chaserSpotters, viewport) : chaserSpotters), [chaserSpotters, viewport]);
  const visiblePoiPlaces = useMemo(() => (viewport ? filterViewportPoints(poiPlaces, viewport) : poiPlaces), [poiPlaces, viewport]);
  const chaserNetReportPoints = useMemo(() => chaserNetReports.map(chaserNetReportToMapPoint), [chaserNetReports]);
  const clusteredTeamPositions = visibleTeamPositions;
  // Active Spotter Network positions remain individually visible at regional/chase zoom, while a
  // national view becomes readable population clusters. Isolated spotters still render alone.
  const clusteredChaserSpotters = useMemo(() => viewport
    ? clusterViewportPoints(visibleChaserSpotters, viewport, { individualAtZoom: 6, mediumAtZoom: 4.5, mediumCellDegrees: 0.35, farCellDegrees: 1.4 })
    : visibleChaserSpotters, [visibleChaserSpotters, viewport]);
  const clusteredChaserNetMembers = useMemo(() => (viewport ? filterViewportPoints(chaserNetMembers, viewport) : chaserNetMembers), [chaserNetMembers, viewport]);
  const clusteredChaserNetReports = useMemo(() => (viewport ? filterViewportPoints(chaserNetReportPoints, viewport) : chaserNetReportPoints), [chaserNetReportPoints, viewport]);
  // Road events with real line geometry (see roadCameraProviders.ts) are painted along the actual
  // road via AtlasRoadLineLayer.ts. Only the point-only remainder (ARDOT has no line source at all;
  // other providers' events without a usable line) goes through the point-pin path.
  const operationalRoadConditions = useMemo(() => routeAheadOnly ? roadConditions.filter((event) => navigationRoute.length > 1 ? distanceToRouteMiles(event, navigationRoute) <= 10 : inRouteAheadCorridor(event, gps)) : roadConditions, [roadConditions, routeAheadOnly, navigationRoute, gps]);
  const operationalTrafficCameras = useMemo(() => routeAheadOnly ? trafficCameras.filter((camera) => navigationRoute.length > 1 ? distanceToRouteMiles(camera, navigationRoute) <= 10 : inRouteAheadCorridor(camera, gps)) : trafficCameras, [trafficCameras, routeAheadOnly, navigationRoute, gps]);
  const lineRoadConditions = useMemo(() => operationalRoadConditions.filter((event) => event.geometry.type === "line"), [operationalRoadConditions]);
  const pointOnlyRoadConditions = useMemo(() => operationalRoadConditions.filter((event) => event.geometry.type !== "line"), [operationalRoadConditions]);
  const clusteredRoadConditions = useMemo(() => (viewport ? filterViewportPoints(pointOnlyRoadConditions, viewport) : pointOnlyRoadConditions), [pointOnlyRoadConditions, viewport]);
  // Roughly ten-county and closer views retain every camera. Wider views cluster dense corridors.
  const clusteredTrafficCameras = useMemo(() => viewport
    ? clusterViewportPoints(filterViewportPoints(operationalTrafficCameras, viewport), viewport, { individualAtZoom: 6, mediumAtZoom: 4.5, mediumCellDegrees: 0.28, farCellDegrees: 1.1 })
    : operationalTrafficCameras, [operationalTrafficCameras, viewport]);
  const clusteredSurfaceStations = useMemo(() => (viewport ? filterViewportPoints(surfaceStations, viewport) : surfaceStations), [surfaceStations, viewport]);
  const visibleStormReports = useMemo(() => viewport ? filterViewportPoints(stormReports, viewport) : stormReports, [stormReports, viewport]);
  const visibleRiverGauges = useMemo(() => viewport ? filterViewportPoints(riverGauges, viewport) : riverGauges, [riverGauges, viewport]);
  useEffect(() => {
    if (compact) return;
    window.dispatchEvent(new CustomEvent("codeblack:map-operational-update", { detail: { roads: operationalRoadConditions, reports: stormReports } }));
  }, [compact, operationalRoadConditions, stormReports]);

  latestRef.current = { gps, rangeRings, expanded };

  useEffect(() => {
    incrementAtlasCounter("reactMounts");
    return () => {
      incrementAtlasCounter("reactUnmounts");
    };
  }, []);

  const recenter = useCallback((mode: AtlasCameraMode = "FOLLOW_NORTH") => {
    const map = mapRef.current;
    if (!map || !gps) return;
    if (interactionResumeTimerRef.current != null) {
      window.clearTimeout(interactionResumeTimerRef.current);
      interactionResumeTimerRef.current = null;
    }
    interactionResumeAtRef.current = 0;
    setCameraMode("RECENTERING");
    const camera = applyAtlasCamera(map, gps, mode, expanded, bearing, compact);
    setBearing(camera.bearing);
    setPitch(camera.pitch);
    window.setTimeout(() => setCameraMode(mode), 650);
  }, [bearing, expanded, gps, compact]);

  // The interaction listeners below are attached once at map-construction time (mapbox instances
  // aren't re-created on every render), so they close over whatever `recenter`/`cameraMode` were at
  // that moment -- reading through refs instead keeps them current without re-attaching listeners.
  const recenterRef = useRef(recenter);
  recenterRef.current = recenter;
  useEffect(() => {
    if (cameraMode === "FOLLOW_NORTH" || cameraMode === "FOLLOW_HEADING") autoModeRef.current = cameraMode;
  }, [cameraMode]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    if (!hasMapboxToken()) {
      setMapError("MAPBOX_TOKEN_MISSING");
      setMapState("TOKEN_MISSING");
      return;
    }
    mapboxgl.accessToken = mapboxAccessToken();
    try {
      setMapState("INITIALIZING");
      const initial = latestRef.current;
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: styleUri,
        center: initial.gps ? [initial.gps.lon, initial.gps.lat] : [-94.13, 36.45],
        zoom: INTRO_START_ZOOM,
        bearing: 0,
        pitch: 0,
        minTileCacheSize: 4,
        maxTileCacheSize: initial.expanded ? 48 : 24,
        refreshExpiredTiles: false,
        performanceMetricsCollection: false,
        crossSourceCollisions: false,
        attributionControl: false,
        logoPosition: "bottom-right",
        antialias: false,
        fadeDuration: 120,
        preserveDrawingBuffer: ATLAS_DIAGNOSTICS_ENABLED,
      });
      mapRef.current = map;
      incrementAtlasCounter("mapConstructors");
      incrementAtlasMapInstances();
      map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");

      function realOriginalEvent(event: unknown): Event | undefined {
        return typeof event === "object" && event !== null && "originalEvent" in event ? (event as { originalEvent?: Event }).originalEvent : undefined;
      }
      const markUserInteraction = (event: unknown) => {
        if (!realOriginalEvent(event)) return;
        setCameraMode("USER_INTERACTING");
        // Actively dragging counts as "paused" indefinitely -- the real 2-minute countdown starts
        // once they let go (markFree), not while their finger/mouse is still on the map.
        if (interactionResumeTimerRef.current != null) {
          window.clearTimeout(interactionResumeTimerRef.current);
          interactionResumeTimerRef.current = null;
        }
        interactionResumeAtRef.current = Infinity;
      };
      const markFree = (event: unknown) => {
        // Mapbox fires dragend/zoomend/rotateend/pitchend for the CAMERA API's own programmatic
        // moves too (flyTo/easeTo), not just real touch/mouse gestures -- confirmed live that the
        // cinematic intro's flyTo, the recenter easeTo, and the compact zoom-cycle's periodic
        // easeTo were all landing here every time they finished, each one unconditionally re-
        // arming a fresh 2-minute "user is interacting" pause (interactionResumeAtRef) with no
        // originalEvent guard -- unlike markUserInteraction right above, which already has one.
        // That meant the mosaic loop and auto-follow's own periodic camera moves kept blocking
        // themselves from ever running, near-permanently, which is what "mosaic isn't rendering"
        // and inconsistent zoom cycling actually were. Only a real user gesture (which DOES carry
        // an originalEvent) should start this countdown.
        if (!realOriginalEvent(event)) return;
        setCameraMode((mode) => mode === "USER_INTERACTING" ? "FREE" : mode);
        interactionResumeAtRef.current = Date.now() + INTERACTION_PAUSE_MS;
        if (interactionResumeTimerRef.current != null) window.clearTimeout(interactionResumeTimerRef.current);
        interactionResumeTimerRef.current = window.setTimeout(() => {
          interactionResumeAtRef.current = 0;
          interactionResumeTimerRef.current = null;
          // Owner reversed the original "auto-resume follow after 2min idle" ask: once they take
          // manual control of the full map, it stays FREE until they explicitly re-engage FOLLOW via
          // the toolbar toggle -- no more snapping back on its own. The compact Weather-card widget
          // has no follow-mode toggle to re-engage with, so it keeps the original auto-resume.
          if (compact) recenterRef.current(autoModeRef.current);
        }, INTERACTION_PAUSE_MS);
      };
      map.on("dragstart", markUserInteraction);
      map.on("zoomstart", markUserInteraction);
      map.on("rotatestart", markUserInteraction);
      map.on("pitchstart", markUserInteraction);
      map.on("dragend", markFree);
      map.on("zoomend", markFree);
      map.on("rotateend", markFree);
      map.on("pitchend", markFree);
      const samplePixels = () => {
        const canvas = map.getCanvas();
        const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
        if (!gl) {
          setPixelSample("no-webgl");
          return;
        }
        try {
          const px = new Uint8Array(4);
          gl.readPixels(
            Math.max(0, Math.floor(gl.drawingBufferWidth / 2)),
            Math.max(0, Math.floor(gl.drawingBufferHeight / 2)),
            1,
            1,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            px,
          );
          setPixelSample(`rgba(${px[0]},${px[1]},${px[2]},${px[3]})`);
        } catch (error) {
          setPixelSample(error instanceof Error ? error.name : "pixel-error");
        }
      };
      map.on("render", () => {
        renderCountRef.current += 1;
        if (renderCountRef.current === 1 || renderCountRef.current % 60 === 0) {
          setRenderCount(renderCountRef.current);
        }
      });
      map.on("idle", () => {
        idleCountRef.current += 1;
        setIdleCount(idleCountRef.current);
        samplePixels();
      });
      // "idle" used to also call setViewport(viewportFromMap(map)) here. "idle" is a rendering
      // signal, not a viewport-change signal -- it fires constantly on this always-live map (every
      // radar-loop frame swap, every mosaic tick, every tile settle), and viewportFromMap() returns
      // a brand-new object each call. That meant every viewport-keyed provider effect (traffic
      // cameras, road conditions, chaser net) saw a "changed" dependency dozens of times a second,
      // aborting its in-flight fetch before it could ever complete -- confirmed live as cameras
      // stuck on "provider unavailable" until the user manually panned/zoomed once, which let a
      // moveend/zoomend-triggered fetch finally run uninterrupted. moveend/zoomend already cover
      // every real viewport change; idle firing the same update added nothing but the thrash.
      map.on("moveend", () => setViewport(viewportFromMap(map)));
      map.on("zoomend", () => setViewport(viewportFromMap(map)));
      // Seed viewport once, here on load, rather than relying on idle for it -- without this, a
      // session that never pans/zooms (GPS denied/unavailable, so none of the auto-follow jumpTo/
      // easeTo calls that would otherwise fire moveend ever run) leaves viewport permanently null
      // and every provider layer stuck on "not configured" forever, since only moveend/zoomend
      // update it now.
      setViewport(viewportFromMap(map));
      map.on("click", (event) => {
        onPointSelectRef.current?.({
          lat: Number(event.lngLat.lat.toFixed(5)),
          lon: Number(event.lngLat.lng.toFixed(5)),
        });
      });
      map.getCanvas().addEventListener("webglcontextlost", () => {
        setMapState("WEBGL_ERROR");
        setMapError("WEBGL_CONTEXT_LOST");
      });
      map.on("error", (event) => {
        // A missing provider tile is recoverable. Mapbox emits it through the same global error
        // channel as a failed base-style initialization; treating every tile 404 as STYLE_ERROR
        // covered the working map with a fatal-session overlay.
        if (map.isStyleLoaded()) return;
        setMapState("STYLE_ERROR");
        setMapError(event.error?.message ?? "MAPBOX_GL_ERROR");
      });
      const initializeStyle = () => {
        if (styleInitializedRef.current || !map.isStyleLoaded()) return;
        styleInitializedRef.current = true;
        incrementAtlasCounter("styleLoads");
        styleInfoRef.current = ATLAS_STYLE_TUNING_DISABLED ? {
          modifiedLayers: 0,
          firstSymbolLayerId: map.getStyle().layers?.find((layer) => layer.type === "symbol")?.id,
          lastMapError: "",
        } : tuneAtlasStyle(map);
        setLoaded(true);
        setMapState("READY");
        // The cinematic wide-to-operating-zoom intro used to run right here, gated on GPS being
        // ready at this exact moment -- but map-style-ready and first-GPS-fix arrive independently,
        // and style-ready usually wins the race (more so now that the compact card skips single-
        // site radar fetch entirely, making it even faster). When GPS lost that race, this whole
        // block silently never ran and the map was stuck at its construction-time fallback center/
        // zoom forever -- looked like "doesn't auto-center," "zoom doesn't run." Moved to its own
        // effect below keyed on [loaded, gps] so it fires whenever GPS actually becomes available,
        // regardless of which one was ready first.
        stopMosaicRef.current = startAtlasMosaicLayer(
          map,
          () => mosaicVisibleRef.current && activeRef.current,
          styleInfoRef.current.firstSymbolLayerId,
          setMosaicStatus,
        );
        updateAtlasSelectedPoint(map, selectedPoint);
        updateAtlasRangeRings(map, latestRef.current.gps, latestRef.current.rangeRings);
      };
      map.on("load", initializeStyle);
      map.on("style.load", initializeStyle);
      map.on("idle", initializeStyle);
    } catch (error) {
      setMapError(error instanceof Error ? error.message : "MAPBOX_GL_INIT_FAILED");
      setMapState("STYLE_ERROR");
    }

    return () => {
      stopMosaicRef.current?.();
      stopMosaicRef.current = null;
      if (interactionResumeTimerRef.current != null) {
        window.clearTimeout(interactionResumeTimerRef.current);
        interactionResumeTimerRef.current = null;
      }
      const map = mapRef.current;
      if (map) {
        map.remove();
        incrementAtlasCounter("mapRemoves");
        decrementAtlasMapInstances();
      }
      mapRef.current = null;
    };
  }, [styleUri]);

  // The one-time cinematic wide-to-operating-zoom intro, decoupled from the map-construction effect
  // above so it fires whenever GPS actually becomes available -- not just if GPS happened to already
  // be ready the instant the map style finished loading (see the comment left in its place above).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !gps || introAppliedRef.current) return;
    introAppliedRef.current = true;
    // Also seeds the throttled ongoing-follow effect's own "last applied" marker so it doesn't
    // immediately re-animate the camera again on this same GPS value right behind the cinematic
    // flyTo -- two competing camera animations at once looks janky, not premium.
    lastGpsAppliedRef.current = { gps, at: Date.now() };
    updateAtlasVehicleLayer(map, gps, vehicleMarkerStyleRef.current);
    const introZoom = zoomForSpeed(gps.speedMph, expanded, compact);
    map.flyTo({
      center: [gps.lon, gps.lat],
      zoom: introZoom,
      duration: INTRO_DURATION_MS,
      easing: (t) => 1 - (1 - t) ** 3,
      essential: true,
    });
    setBearing(0);
    setPitch(0);
    // Owner asked for the initial GPS-lock zoom to stay a one-shot: settle into FREE (manual
    // control) right after it plays instead of continuing to auto-follow every GPS tick. The
    // compact Weather-card widget has no follow-mode toggle of its own, so it keeps following.
    setCameraMode(compact ? "FOLLOW_NORTH" : "FREE");
  }, [loaded, gps, expanded, compact]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const timer = window.setTimeout(() => {
      if (mapRef.current !== map) return;
      map.resize();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [expanded, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !active) return;
    const timers = [0, 120, 420].map((delay) => window.setTimeout(() => {
      if (mapRef.current !== map) return;
      map.resize();
      const currentGps = latestRef.current.gps;
      // Only re-snap to GPS on this page-becoming-active catch-up if we're still in a follow mode --
      // once the owner has taken manual control (FREE), switching pages/tabs and back must not yank
      // the view back to the vehicle out from under them.
      const stillFollowing = cameraMode === "FOLLOW_NORTH" || cameraMode === "FOLLOW_HEADING" || cameraMode === "RECENTERING";
      if (currentGps && stillFollowing) {
        map.jumpTo({
          center: [currentGps.lon, currentGps.lat],
          zoom: zoomLockedRef.current ? map.getZoom() : zoomForSpeed(currentGps.speedMph, latestRef.current.expanded, compact),
          bearing,
          pitch,
        });
      }
    }, delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [active, bearing, cameraMode, compact, loaded, pitch]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !gps) return;
    const now = Date.now();
    if (!shouldApplyGpsUpdate(lastGpsAppliedRef.current, gps, now)) return;
    lastGpsAppliedRef.current = { gps, at: now };
    updateAtlasVehicleLayer(map, gps, vehicleMarkerStyleRef.current);
    // Skip the actual camera move when this instance isn't the one on screen -- the vehicle marker
    // and breadcrumb above still stay current, so there's no stale-position catch-up animation when
    // the user swipes back to this page, but the expensive easeTo (and the render/GPU work it
    // drives) isn't spent on a canvas nobody's looking at right now.
    if (!activeRef.current) return;
    if (cameraMode === "FOLLOW_NORTH" || cameraMode === "FOLLOW_HEADING" || cameraMode === "RECENTERING") {
      const camera = applyAtlasCamera(map, gps, cameraMode, expanded, bearing, compact, zoomLocked);
      setBearing(camera.bearing);
      setPitch(camera.pitch);
    }
  }, [bearing, cameraMode, expanded, gps, loaded, compact, zoomLocked]);

  // Catch the camera up the moment this instance becomes the visible one again -- the effect above
  // intentionally skipped every camera move while inactive, so without this the view would sit on
  // wherever it was left until the next GPS tick happened to fire. Eased rather than an instant
  // jumpTo: a hard snap on every page switch read as "the map doesn't move" -- this is a single
  // one-shot animation (not the continuous per-GPS-tick easing the skip above is actually saving
  // the cost of), so animating it is effectively free.
  useEffect(() => {
    const map = mapRef.current;
    if (!active || !map || !loaded || !gps) return;
    if (cameraMode !== "FOLLOW_NORTH" && cameraMode !== "FOLLOW_HEADING" && cameraMode !== "RECENTERING") return;
    map.easeTo({
      center: [gps.lon, gps.lat],
      zoom: zoomLockedRef.current ? map.getZoom() : zoomForSpeed(gps.speedMph, expanded, compact),
      bearing,
      pitch,
      duration: 600,
      easing: (t) => 1 - (1 - t) ** 3,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only meant to fire on the active edge
  }, [active]);

  // Compact card's zoom "cycles" (mosaicCardZoomForTime) on wall-clock time, but nothing else here
  // re-renders the camera on a clock -- the GPS-follow effect above only fires on a real GPS update,
  // which can be many seconds apart while parked, and would otherwise leave the cycle's wide phase
  // invisible. Poll for the target changing (not a fixed-interval easeTo every tick, which would
  // restart the same animation mid-flight and look stuttery) and only ease when it actually does.
  const compactZoomRef = useRef(-1);
  useEffect(() => {
    if (!compact) return;
    // Deliberately NOT depending on gps/expanded/active here (read via latestRef/activeRef
    // instead) -- App.tsx builds a new gps object on every telemetry tick, and this effect
    // re-running that often would clear+restart the interval before its 2s delay ever elapsed,
    // starving the poll and leaving the camera stuck wherever it last eased to (this is why the
    // wide-zoom phase of the cycle was never releasing back to default).
    const timer = window.setInterval(() => {
      const map = mapRef.current;
      const currentGps = latestRef.current.gps;
      if (!map || !activeRef.current || !loaded || !currentGps) return;
      if (cameraMode !== "FOLLOW_NORTH" && cameraMode !== "FOLLOW_HEADING" && cameraMode !== "RECENTERING") return;
      if (Date.now() < interactionResumeAtRef.current) return;
      const target = zoomForSpeed(currentGps.speedMph, latestRef.current.expanded, compact);
      if (Math.abs(target - compactZoomRef.current) < 0.05) return;
      compactZoomRef.current = target;
      // Ease-out cubic (matches the recenter/catch-up easing elsewhere in this file) rather than
      // ease-in-out -- owner wanted the transition to "zoom out fast and then slow down before it
      // settles" instead of a slow start. Duration went 4000ms -> 6500ms -> this (still felt too
      // quick) -- bumped again, and MOSAIC_CARD_ZOOM_WIDE_MS in AtlasCameraController.ts grew to
      // match so the wide phase still holds for a few seconds instead of the transition eating the
      // whole window and immediately reversing.
      map.easeTo({ zoom: target, duration: 10000, easing: (t) => 1 - (1 - t) ** 3 });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [compact, loaded, cameraMode]);

  // A vehicle marker style change from Settings is a rare, deliberate user action, not GPS noise --
  // repaint immediately rather than waiting for the throttled GPS-update effect above to next fire.
  useEffect(() => {
    const map = mapRef.current;
    const currentGps = latestRef.current.gps;
    if (!map || !loaded || !currentGps) return;
    updateAtlasVehicleLayer(map, currentGps, vehicleMarkerStyle);
  }, [vehicleMarkerStyle, loaded]);

  // Breadcrumb trail is a Locate-page driving aid (with its own Clear Trail button there) -- not a
  // togglable Layers-page item, and not part of "the dashboard shows only what's configured." The
  // compact Weather card never rendered a trail-clearing control, so a trail was quietly building up
  // there with zero user control; simplest fix is to just not draw it on the compact instance at all.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    updateAtlasBreadcrumbLayer(map, compact || !breadcrumbsVisible ? [] : trail);
  }, [loaded, trail, compact, breadcrumbsVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    updateAtlasAlertsLayer(map, alerts, { warnings: warningsVisible, watches: watchesVisible, mesoscaleDiscussions: mesoscaleDiscussionsVisible, specialStatements: specialStatementsVisible }, styleInfoRef.current.firstSymbolLayerId);
  }, [alerts, warningsVisible, watchesVisible, mesoscaleDiscussionsVisible, specialStatementsVisible, loaded]);

  useEffect(() => {
    if (!watchesVisible) return;
    let cancelled = false;
    const load = async () => {
      const polygons = await getActiveWatchPolygons();
      if (!cancelled) setWatches(polygons);
    };
    void load();
    const timer = window.setInterval(load, WATCHES_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [watchesVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    updateAtlasWatchesLayer(map, watches, alerts, watchesVisible, styleInfoRef.current.firstSymbolLayerId);
  }, [watches, alerts, watchesVisible, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    updateAtlasTeamLayer(map, clusteredTeamPositions, teamPinStyle, teamVisible);
  }, [clusteredTeamPositions, teamPinStyle, teamVisible, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    updateAtlasSpotterLayer(map, clusteredChaserSpotters, chaserPinStyle, chasersVisible);
  }, [clusteredChaserSpotters, chaserPinStyle, chasersVisible, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    updateAtlasPoiLayer(map, visiblePoiPlaces, nearbyBest, customPoiPins, poiVisible);
  }, [visiblePoiPlaces, nearbyBest, customPoiPins, poiVisible, loaded]);

  // Loops the last RADAR_LOOP_FRAME_COUNT scans (newest-first from the worker) rather than showing
  // a single static frame -- radarPlaybackIndex 0 is always the newest/live frame; the interval
  // below walks it back through history and wraps to 0, matching a normal radar-loop UX.
  const [radarFrames, setRadarFrames] = useState<RadarFrame[]>([]);
  const [radarPlaybackIndex, setRadarPlaybackIndex] = useState(0);
  const [radarLoadError, setRadarLoadError] = useState(false);
  const [radarPrimarySite, setRadarPrimarySite] = useState<string | null>(null);
  const [radarSelectedSite, setRadarSelectedSite] = useState<string | null>(null);
  const [radarSiteFailoverReason, setRadarSiteFailoverReason] = useState("");
  const [radarNearbySites, setRadarNearbySites] = useState<RadarSite[]>([]);
  const [radarSiteOverride, setRadarSiteOverride] = useState(() => {
    try { return localStorage.getItem(RADAR_SITE_OVERRIDE_KEY) ?? ""; } catch { return ""; }
  });
  const radarSelectedSiteRef = useRef<string | null>(null);
  const radarPrimaryRecoveryStreakRef = useRef(0);
  const chooseRadarSite = (site: string) => {
    setRadarSiteOverride(site);
    setRadarFrames([]);
    setRadarPlaybackIndex(0);
    radarSelectedSiteRef.current = null;
    radarPrimaryRecoveryStreakRef.current = 0;
    try {
      if (site) localStorage.setItem(RADAR_SITE_OVERRIDE_KEY, site);
      else localStorage.removeItem(RADAR_SITE_OVERRIDE_KEY);
    } catch { /* preference remains active for this session */ }
  };
  const radarFrame = radarFrames[radarPlaybackIndex] ?? null;
  // Reflectivity alone doesn't show rotation -- a chaser needs VEL/SRV to spot a mesocyclone and CC
  // to catch a debris-ball tornado confirmation. SRV additionally requires a storm motion vector set
  // (the worker 400s without one), so the product switcher and storm-motion control are paired.
  const [radarProduct, setRadarProduct] = useState<RadarProduct>("REF");
  // The worker's "tilt" is an elevation CUT INDEX (1 = lowest), not a degree value -- degrees only
  // exist per-fetched-frame as elevationAngle. Requesting a degree-shaped number here (e.g. 0.5) never
  // matches a real index, so the worker silently falls back to the lowest cut every time regardless
  // of what's selected. Index 1 is a truthful default; the button displays the real elevationAngle
  // off the loaded frame once one exists, not this index.
  const [radarTilt, setRadarTilt] = useState(1);
  const [radarAvailableTilts, setRadarAvailableTilts] = useState<number[]>([1]);
  const [stormMotion, setStormMotionState] = useState<StormMotion | null>(null);
  const [stormMotionOpen, setStormMotionOpen] = useState(false);
  // A Level II frame request can take several seconds. Key site selection to a roughly six-mile
  // location cell so ordinary GPS jitter does not cancel and restart the request forever.
  const radarFocusLat = gps ? Math.round(gps.lat * 10) / 10 : null;
  const radarFocusLon = gps ? Math.round(gps.lon * 10) / 10 : null;
  const applyStormMotion = async (directionDegrees: number, speedKnots: number) => {
    const motion = await setRadarStormMotion({ directionDegrees, speedKnots, source: "MANUAL" });
    setStormMotionState(motion);
    setStormMotionOpen(false);
  };
  useEffect(() => {
    if (!radarVisible) {
      setRadarFrames([]);
      setRadarPlaybackIndex(0);
      setRadarPrimarySite(null);
      setRadarSelectedSite(null);
      radarSelectedSiteRef.current = null;
      radarPrimaryRecoveryStreakRef.current = 0;
      return;
    }
    if (radarProduct === "SRV" && !stormMotion) return;
    let cancelled = false;
    const load = async () => {
      const center = mapRef.current?.getCenter();
      const focus = radarFocusLat != null && radarFocusLon != null ? { lat: radarFocusLat, lon: radarFocusLon } : (center ? { lat: center.lat, lon: center.lng } : null);
      const nearbySites = focus ? await getNearestRadarSites(focus.lat, focus.lon) : await getNearestRadarSites(36.13, -94.16);
      setRadarNearbySites(nearbySites.slice(0, 3));
      const nearestCandidates = nearbySites.slice(0, 3).map((site) => site.id);
      const candidates = radarSiteOverride ? [radarSiteOverride, ...nearestCandidates.filter((site) => site !== radarSiteOverride)].slice(0, 3) : nearestCandidates;
      const primarySite = candidates[0] ?? "KSGF";
      setRadarPrimarySite(primarySite);
      const currentSite = radarSelectedSiteRef.current;
      const loaded = new Map<string, RadarFrame[]>();
      const loadSite = async (site: string) => {
        if (!loaded.has(site)) loaded.set(site, normalizeRadarFrames(await getRadarFrames(site, radarProduct, radarTilt, RADAR_LOOP_FRAME_COUNT), RADAR_LOOP_FRAME_COUNT));
        return loaded.get(site) ?? [];
      };

      let selectedSite = primarySite;
      let frames: RadarFrame[] = [];
      let reason = "";
      if (currentSite && currentSite !== primarySite && candidates.includes(currentSite)) {
        const currentFrames = await loadSite(currentSite);
        const primaryFrames = await loadSite(primarySite);
        if (radarFramesAreOperational(primaryFrames)) {
          radarPrimaryRecoveryStreakRef.current += 1;
          if (radarPrimaryRecoveryStreakRef.current >= 2 || !radarFramesAreOperational(currentFrames)) {
            frames = primaryFrames;
            radarPrimaryRecoveryStreakRef.current = 0;
          } else {
            selectedSite = currentSite;
            frames = currentFrames;
            reason = "PRIMARY RECOVERY CONFIRMING";
          }
        } else {
          radarPrimaryRecoveryStreakRef.current = 0;
          selectedSite = currentSite;
          frames = currentFrames;
          reason = radarFailoverReason(primaryFrames);
        }
      } else {
        const primaryFrames = await loadSite(primarySite);
        frames = primaryFrames;
        reason = radarFailoverReason(primaryFrames);
        if (!radarFramesAreOperational(primaryFrames)) {
          for (const alternate of candidates.slice(1)) {
            const alternateFrames = await loadSite(alternate);
            if (radarFramesAreOperational(alternateFrames)) {
              selectedSite = alternate;
              frames = alternateFrames;
              break;
            }
            if ((!frames[0] || (alternateFrames[0]?.ageSeconds ?? Infinity) < frames[0].ageSeconds) && alternateFrames.length) {
              selectedSite = alternate;
              frames = alternateFrames;
            }
          }
        } else {
          reason = "";
        }
      }
      // If both the held failover and recovered primary are bad, continue through the remaining
      // nearby sites. This also retains the freshest stale result when no current site exists.
      if (!radarFramesAreOperational(frames)) {
        for (const alternate of candidates) {
          if (alternate === selectedSite) continue;
          const alternateFrames = await loadSite(alternate);
          if (radarFramesAreOperational(alternateFrames)) {
            selectedSite = alternate;
            frames = alternateFrames;
            break;
          }
          if ((!frames[0] || (alternateFrames[0]?.ageSeconds ?? Infinity) < frames[0].ageSeconds) && alternateFrames.length) {
            selectedSite = alternate;
            frames = alternateFrames;
          }
        }
      }
      if (cancelled) return;
      const normalized = normalizeRadarFrames(frames, RADAR_LOOP_FRAME_COUNT);
      // A transient worker/network failure must never blank the last usable radar scan. Keep the
      // existing loop visible and let the next refresh recover it.
      if (normalized.length > 0) {
        setRadarLoadError(false);
        setRadarFrames(normalized);
        setRadarPlaybackIndex(0);
        radarSelectedSiteRef.current = selectedSite;
        setRadarSelectedSite(selectedSite);
        setRadarSiteFailoverReason(selectedSite === primarySite ? "" : reason);
      } else {
        setRadarLoadError(true);
      }
      if (frames[0]?.availableTilts?.length) setRadarAvailableTilts(frames[0].availableTilts);
    };
    void load();
    const timer = window.setInterval(load, RADAR_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [radarVisible, radarProduct, radarTilt, stormMotion, radarFocusLat, radarFocusLon, radarSiteOverride]);

  useEffect(() => {
    if (!radarVisible || radarFrames.length < 2) return;
    const timer = window.setInterval(() => {
      setRadarPlaybackIndex((index) => nextPlaybackIndex(index, radarFrames.length));
    }, playbackDelayMs(1));
    return () => window.clearInterval(timer);
  }, [radarVisible, radarFrames.length]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    if (!radarVisible) {
      removeAtlasRadarLayer(map);
      return;
    }
    updateAtlasRadarLayer(map, radarFrame, 0.72, styleInfoRef.current.firstSymbolLayerId, radarFrames);
    // Keep translucent threat areas beneath radar so reflectivity/velocity stay readable, while
    // their strong warning boundaries remain above it for immediate chase-safety recognition.
    const radarLayer = radarFrame ? atlasRadarLayerId(radarFrame.frameId) : null;
    if (radarLayer && map.getLayer(radarLayer)) {
      for (const fillLayer of [ATLAS_ALERTS_FILL_LAYER, ATLAS_WATCHES_FILL_LAYER]) {
        if (map.getLayer(fillLayer)) map.moveLayer(fillLayer, radarLayer);
      }
      for (const lineLayer of [ATLAS_ALERTS_LINE_LAYER, ATLAS_WATCHES_LINE_LAYER]) {
        if (map.getLayer(lineLayer)) map.moveLayer(lineLayer, styleInfoRef.current.firstSymbolLayerId);
      }
    }
  }, [radarFrame, radarFrames, radarVisible, loaded]);

  useEffect(() => {
    if (!viewport || !roadConditionsVisible) {
      setRoadConditions([]);
      setRoadLayerStatus("not-configured");
      return;
    }
    const controller = new AbortController();
    const context = { viewport, detail: zoomDetailLevel(viewport.zoom), sessionId: null };
    setRoadLayerStatus("ready");
    void getRoadConditionsForViewport(context, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setRoadConditions(result.data);
      setRoadLayerStatus(result.status);
    }).catch(() => {
      if (controller.signal.aborted) return;
      setRoadConditions([]);
      setRoadLayerStatus("error");
    });
    return () => controller.abort();
  }, [viewport, roadConditionsVisible]);

  useEffect(() => {
    if (!viewport || !trafficCamerasVisible) {
      setTrafficCameras([]);
      setCameraLayerStatus("not-configured");
      return;
    }
    const controller = new AbortController();
    const context = { viewport, detail: zoomDetailLevel(viewport.zoom), sessionId: null };
    setCameraLayerStatus("ready");
    void getTrafficCamerasForViewport(context, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setTrafficCameras(result.data);
      setCameraLayerStatus(result.status);
    }).catch(() => {
      if (controller.signal.aborted) return;
      setTrafficCameras([]);
      setCameraLayerStatus("error");
    });
    return () => controller.abort();
  }, [viewport, trafficCamerasVisible]);

  useEffect(() => {
    if (!viewport || !surfaceStationsVisible) {
      setSurfaceStations([]);
      setSurfaceStationLayerStatus("not-configured");
      return;
    }
    const controller = new AbortController();
    const context = { viewport, detail: zoomDetailLevel(viewport.zoom), sessionId: null };
    setSurfaceStationLayerStatus("ready");
    void getSurfaceStationsForViewport(context, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setSurfaceStations(result.data);
      setSurfaceStationLayerStatus(result.status);
    }).catch(() => {
      if (controller.signal.aborted) return;
      setSurfaceStations([]);
      setSurfaceStationLayerStatus("error");
    });
    return () => controller.abort();
  }, [viewport, surfaceStationsVisible]);

  useEffect(() => {
    if (!viewport || !chaserNetVisible) {
      setChaserNetMembers([]);
      setChaserNetReports([]);
      return;
    }
    let cancelled = false;
    const context = { viewport, detail: zoomDetailLevel(viewport.zoom), sessionId: null };
    void Promise.all([
      getChaserNetMembersForViewport(context),
      getChaserNetReportsForViewport(context),
    ]).then(([members, reports]) => {
      if (cancelled) return;
      setChaserNetMembers(members.data);
      setChaserNetReports(reports.data);
    });
    return () => {
      cancelled = true;
    };
  }, [viewport, chaserNetVisible]);

  useEffect(() => {
    if (!stormReportsVisible || !gps) { setStormReports([]); return; }
    let cancelled = false;
    void getNearbyStormReports(gps, 250, 2).then((result) => {
      if (!cancelled) setStormReports(result.reports.filter((report) => Date.now() - report.validTime <= 2 * 60 * 60_000));
    });
    const timer = window.setInterval(() => {
      void getNearbyStormReports(gps, 250, 2).then((result) => { if (!cancelled) setStormReports(result.reports); });
    }, 5 * 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [stormReportsVisible, gps?.lat, gps?.lon]);

  useEffect(() => {
    if (!riverGaugesVisible || !viewport || viewport.zoom < 5) { setRiverGauges([]); return; }
    const controller = new AbortController();
    void getRiverGaugesForViewport(viewport, controller.signal).then((gauges) => setRiverGauges(gauges)).catch(() => { if (!controller.signal.aborted) setRiverGauges([]); });
    return () => controller.abort();
  }, [riverGaugesVisible, viewport]);

  useEffect(() => {
    if (!routeAheadOnly || !gps || !selectedPoint || !hasMapboxToken()) { setNavigationRoute([]); return; }
    const controller = new AbortController();
    void fetchNavigationRoute(gps, selectedPoint, mapboxAccessToken(), controller.signal).then(setNavigationRoute).catch(() => { if (!controller.signal.aborted) setNavigationRoute([]); });
    return () => controller.abort();
  }, [routeAheadOnly, gps?.lat, gps?.lon, selectedPoint?.lat, selectedPoint?.lon]);

  // QA/screenshot-automation hook only -- not called from any in-app UI. Camera marker positions
  // move with live provider coverage and viewport, which made landing on a real, un-clustered
  // camera pin by panning/tapping alone unreliable for scripted capture. This lets an external
  // script (e.g. the S24 screenshot baseline) jump the real map to a real, currently-loaded
  // camera's coordinates so it can screenshot a genuine camera popup -- it never fabricates a
  // camera or its data, it only centers the already-live map on one that's already loaded.
  useEffect(() => {
    // Home's radar module, the Weather page's compact map, and the primary Map/Expanded Radar
    // instance can all be mounted at once (see the "active" prop comment above) -- each one runs
    // this effect, so without the !compact guard, whichever mounts last silently wins the shared
    // window function regardless of which map the screenshot script actually wants to control.
    if (compact) return;
    (window as any).__codeblackDebugJumpToCamera = () => {
      const map = mapRef.current;
      const camera = trafficCameras.find((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon));
      if (!map || !camera) return { ok: false, reason: !map ? "NO_MAP" : "NO_CAMERA_LOADED" };
      map.jumpTo({ center: [camera.lon, camera.lat], zoom: 16 });
      return { ok: true, cameraId: camera.id, lat: camera.lat, lon: camera.lon };
    };
    return () => {
      delete (window as any).__codeblackDebugJumpToCamera;
    };
  }, [trafficCameras, compact]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    updateAtlasRoadConditionLayer(map, clusteredRoadConditions, roadConditionsVisible);
    updateAtlasRoadLineLayer(map, lineRoadConditions, roadConditionsVisible, styleInfoRef.current.firstSymbolLayerId);
    updateAtlasTrafficCameraLayer(map, clusteredTrafficCameras, trafficCamerasVisible);
    updateAtlasSurfaceStationLayer(map, clusteredSurfaceStations, surfaceStationsVisible);
    updateAtlasStormReportLayer(map, visibleStormReports, stormReportsVisible);
    updateAtlasRiverGaugeLayer(map, visibleRiverGauges, riverGaugesVisible);
    updateAtlasNavigationRouteLayer(map, navigationRoute, routeAheadOnly, styleInfoRef.current.firstSymbolLayerId);
    updateAtlasChaserNetLayer(map, clusteredChaserNetMembers, chaserPinStyle, chaserNetVisible);
    updateAtlasChaserNetReportLayer(map, clusteredChaserNetReports, chaserPinStyle, chaserNetVisible);
  }, [clusteredRoadConditions, lineRoadConditions, clusteredTrafficCameras, roadConditionsVisible, trafficCamerasVisible, clusteredSurfaceStations, surfaceStationsVisible, visibleStormReports, stormReportsVisible, visibleRiverGauges, riverGaugesVisible, navigationRoute, routeAheadOnly, clusteredChaserNetMembers, clusteredChaserNetReports, chaserPinStyle, chaserNetVisible, loaded]);


  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    updateAtlasRangeRings(map, gps, rangeRings);
  }, [gps, loaded, rangeRings]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    updateAtlasSelectedPoint(map, selectedPoint);
  }, [loaded, selectedPoint]);

  useEffect(() => {
    const map = mapRef.current;
    let style: ReturnType<mapboxgl.Map["getStyle"]> | null = null;
    if (map && loaded) {
      try {
        style = map.getStyle();
      } catch (error) {
        setMapError(error instanceof Error ? error.message : "MAPBOX_STYLE_NOT_READY");
      }
    }
    const sourceCount = style?.sources ? Object.keys(style.sources).length : 0;
    const layerCount = style?.layers?.length ?? 0;
    const center = map?.getCenter();
    const canvas = map?.getCanvas();
    const rect = canvas?.getBoundingClientRect();
    const canvasCount = containerRef.current?.querySelectorAll("canvas").length ?? 0;
    writeAtlasDiagnostics({
      renderer: "mapbox-gl-js",
      engine: "atlas",
      mapboxVersion: mapboxgl.version,
      styleUri,
      styleLoaded: loaded,
      mapState,
      mapInitialized: Boolean(map),
      mapInstanceCount: atlasMapInstanceCount(),
      canvasCount,
      webglContextCount: canvasCount,
      lifecycle: atlasLifecycleCounters(),
      cameraMode,
      zoom: Number((map?.getZoom() ?? 0).toFixed(2)),
      bearing: Number((map?.getBearing() ?? bearing).toFixed(1)),
      pitch: Number((map?.getPitch() ?? pitch).toFixed(1)),
      center: center ? { lat: Number(center.lat.toFixed(5)), lon: Number(center.lng.toFixed(5)) } : null,
      gps,
      mosaicVisible,
      radarLayerLoaded: radarVisible && Boolean(radarFrame),
      canvas: canvas && rect ? {
        cssWidth: Math.round(rect.width),
        cssHeight: Math.round(rect.height),
        backingWidth: canvas.width,
        backingHeight: canvas.height,
        devicePixelRatio: window.devicePixelRatio,
      } : null,
      canvasPixelSample: pixelSample,
      sourceCount,
      layerCount,
      lastMapError: mapError || styleInfoRef.current.lastMapError,
      fallbackState: mapError ? "ATLAS_ERROR_LEGACY_AVAILABLE" : "ATLAS_ACTIVE",
      updatedAt: Date.now(),
    });
    writeMapRuntimeDiagnostics({
      renderer: "mapbox-gl-js",
      styleUri,
      styleLoaded: loaded,
      modifiedLayers: styleInfoRef.current.modifiedLayers,
      missingTargetLayers: [],
      zoom: Number((map?.getZoom() ?? 0).toFixed(2)),
      bearing: Number((map?.getBearing() ?? bearing).toFixed(1)),
      pitch: Number((map?.getPitch() ?? pitch).toFixed(1)),
      cameraMode,
      gpsAccuracyM: gps?.accuracyM ?? null,
      speedMph: gps?.speedMph ?? null,
      mosaicVisible,
      radarOpacity: radarVisible ? 0.75 : 0,
      product: "REF",
      provider: "mapbox",
      updatedAt: Date.now(),
    });
  }, [bearing, cameraMode, gps, idleCount, loaded, mapError, mapState, mosaicVisible, pitch, pixelSample, radarFrame, radarVisible, renderCount, styleUri]);

  const visibleError = mapError && mapState !== "READY" ? mapError : "";
  const visibleErrorTitle = visibleError === "WEBGL_CONTEXT_LOST" ? "Map Renderer Unavailable" : visibleError;
  const visibleErrorDetail = visibleError === "WEBGL_CONTEXT_LOST"
    ? "WebGL rendering is unavailable in this browser session. Live data panels and point workflow remain isolated from the renderer."
    : "Atlas could not initialize the map renderer for this session.";
  const canvasCount = containerRef.current?.querySelectorAll("canvas").length ?? 0;
  const atlasStateLabel = ATLAS_DIAGNOSTICS_ENABLED
    ? `${mapState}${loaded ? "" : " LOADING"} c${canvasCount} r${renderCount} i${idleCount} ${pixelSample}`
    : `${mapState}${loaded ? "" : " LOADING"}`;

  const followLabel = cameraMode === "FOLLOW_HEADING" ? "HEADING" : cameraMode === "FREE" ? "RECENTER" : "NORTH";
  const cameraStatusLabel = cameraMode === "FOLLOW_HEADING"
    ? "FOLLOW HEADING"
    : cameraMode === "FOLLOW_NORTH" || cameraMode === "RECENTERING"
      ? "FOLLOW NORTH"
      : cameraMode === "USER_INTERACTING"
        ? "PANNING"
        : "FREE";
  const roadProviderCount = viewport ? roadProvidersForViewport(viewport).length : 0;
  const trafficCameraProviderCount = viewport ? trafficCameraProvidersForViewport(viewport).length : 0;
  const providerStatusLabel = (status: ViewportLayerResult<unknown>["status"], count: number, providerCount: number) => {
    if (status === "ready") return count > 0 ? `${count}` : "available";
    if (status === "stale") return `${count} stale`;
    if (status === "empty") return "none in view";
    if (status === "outside-coverage") return "outside coverage";
    if (status === "not-configured") return "not configured";
    if (status === "unavailable" || status === "error") return "provider unavailable";
    return providerCount > 0 ? "available" : "outside coverage";
  };
  // Compact, truthful field status -- reuses the same providerStatusLabel logic already driving
  // the Layers popover rather than a second status vocabulary, and only surfaces a badge for a
  // layer the user actually turned on (an off-by-choice layer isn't a failure worth a badge for).
  const mosaicStatusLabel = mosaicVisible
    ? { loading: "MOSAIC LOADING", ready: "MOSAIC LIVE", stale: "MOSAIC STALE", unavailable: "MOSAIC UNAVAILABLE" }[mosaicStatus]
    : null;
  const roadStatusLabel = roadConditionsVisible
    ? `ROADS ${providerStatusLabel(roadLayerStatus, roadConditions.length, roadProviderCount).toUpperCase()}`
    : null;
  const cameraProviderStatusLabel = trafficCamerasVisible
    ? `CAMS ${providerStatusLabel(cameraLayerStatus, trafficCameras.length, trafficCameraProviderCount).toUpperCase()}`
    : null;
  // Per-category counts of what's actually in view right now, not a running total or a per-point
  // radius -- panning/zooming changes this live the same way it already does for CAMS above,
  // since visiblePoiPlaces is itself viewport-filtered (see its useMemo).
  const POI_CATEGORY_LABELS: Record<string, string> = { gas: "GAS", hospital: "ER", food: "FOOD", lodging: "LODGE" };
  const poiStatusLabel = poiVisible
    ? (() => {
        const counts = new Map<string, number>();
        for (const place of visiblePoiPlaces) counts.set(place.category, (counts.get(place.category) ?? 0) + 1);
        const parts = Object.keys(POI_CATEGORY_LABELS)
          .filter((category) => counts.get(category))
          .map((category) => `${POI_CATEGORY_LABELS[category]} ${counts.get(category)}`);
        return parts.length > 0 ? `POI ${parts.join(" · ")}` : "POI NONE IN VIEW";
      })()
    : null;
  // A radar frame is only ever as fresh as the last successful worker fetch -- in a chase, a stale
  // frame with no clear "this is old" signal is worse than no frame at all, since it can read as
  // current when the actual storm has moved. Always show the age, not just a LIVE/CACHED enum.
  // "LOADING" is only ever true while a fetch is actually in flight and expected to resolve --
  // with no worker URL configured, no fetch ever starts, so it would otherwise read "LOADING"
  // forever and look hung rather than telling a chaser (or whoever's checking System) what's
  // actually missing.
  const radarStatusLabel = radarVisible
    ? radarWorkerMissingOnWeb()
      ? "SINGLE-SITE NOT CONFIGURED"
      : radarProduct === "SRV" && !stormMotion
        ? "SRV NEEDS STORM MOTION"
        : radarLoadError && radarFrame
          ? `${radarProduct} ${ageText(radarFrame.ageSeconds)} OLD · UPDATE FAILED`
          : radarLoadError
            ? "SINGLE-SITE UNAVAILABLE · RETRYING"
        : radarFrame
          ? `${radarProduct} ${ageText(radarFrame.ageSeconds)} OLD${radarFrame.freshness === "STALE" ? " - STALE" : ""}`
          : "SINGLE-SITE LOADING"
    : null;

  return (
    <div className={`${compact ? "atlas-map-shell atlas-map-shell--compact" : "atlas-map-shell"} ${active ? "atlas-map-shell--active" : "atlas-map-shell--inactive"} ${visibleError ? "atlas-map-shell--error" : ""}`} data-testid={compact ? "atlas-map-compact" : "atlas-map-primary"}>
      <div className="atlas-map-canvas-area">
        <div ref={containerRef} className="atlas-map" data-testid={compact ? "atlas-map-canvas-compact" : "atlas-map-canvas-primary"} data-camera-mode={cameraMode} />
        {visibleError && (
          <div className="atlas-map-error" role="status" aria-live="polite">
            <strong>{visibleErrorTitle}</strong>
            <span>{visibleErrorDetail}</span>
          </div>
        )}
        {!compact && escapeControl && <div className="atlas-map-escape-slot" data-testid="atlas-map-escape-slot">{escapeControl}</div>}
        {!compact && (
          <div className="radar-strip atlas-radar-strip">
            {statusLines.map((line, index) => <span key={index}>{line}</span>)}
            <span>{cameraStatusLabel}</span>
            {mosaicStatusLabel && <span>{mosaicStatusLabel}</span>}
            {radarVisible && (!radarFrame || radarLoadError) && <span>{radarStatusLabel}</span>}
            {roadStatusLabel && <span>{roadStatusLabel}</span>}
            {cameraProviderStatusLabel && <span>{cameraProviderStatusLabel}</span>}
            {poiStatusLabel && <span>{poiStatusLabel}</span>}
          </div>
        )}
        {onOpenExpanded && (
          <button type="button" className="atlas-expand-button" aria-label="Expand radar" onClick={(event) => { event.stopPropagation(); onOpenExpanded(); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6" /></svg>
          </button>
        )}
        {/* Compact card dropped its whole control row (see below) for "ultra simple," but that also
            took away the only way to reach layer toggles without leaving the page -- this one small
            icon button is the deliberate exception: just enough to flip Alerts/Team/Spotter Network/POI on
            or off while looking at the dashboard, same popover the full map's LAYERS button opens. */}
        {compact && (
          <button
            type="button"
            className={layersPopoverOpen ? "atlas-layers-button active" : "atlas-layers-button"}
            aria-label="Map layers"
            data-testid="atlas-map-layers-compact"
            onClick={(event) => { event.stopPropagation(); setLayersPopoverOpen((value) => !value); }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 2 7l10 5 10-5-10-5Z" /><path d="M2 12l10 5 10-5" /><path d="M2 17l10 5 10-5" /></svg>
          </button>
        )}
        {layersPopoverOpen && (
          <div className="atlas-layers-popover" role="dialog" aria-label="Map layers" data-testid={compact ? "atlas-map-layers-popover-compact" : "atlas-map-layers-popover-primary"}>
            <div className="atlas-layers-popover__header">
              <div className="atlas-layers-popover__title">Layers</div>
              <button type="button" data-testid={compact ? "atlas-map-layers-close-compact" : "atlas-map-layers-close-primary"} aria-label="Close map layers" onClick={() => setLayersPopoverOpen(false)}>Close</button>
            </div>
            <div className="atlas-layers-popover__presets" aria-label="Operational layer presets">
              {(["intercept", "travel", "flood", "night", "low-bandwidth"] as const).map((preset) => <button key={preset} type="button" onClick={() => applyLayerPreset(preset)}>{preset === "low-bandwidth" ? "LOW DATA" : preset.toUpperCase()}</button>)}
            </div>
            <div className="atlas-layers-popover__section">WEATHER</div>
            <label className="atlas-layers-popover__row">
              <input type="checkbox" checked={warningsVisible} onChange={() => toggleLayer("warnings")} />
              <span className="atlas-layers-popover__icon"><LayerGlyph visual="warning" /></span>
              Warnings
            </label>
            <label className="atlas-layers-popover__row">
              <input type="checkbox" checked={watchesVisible} onChange={() => toggleLayer("watches")} />
              <span className="atlas-layers-popover__icon"><LayerGlyph visual="watch" /></span>
              Watches
            </label>
            <label className="atlas-layers-popover__row">
              <input type="checkbox" checked={mesoscaleDiscussionsVisible} onChange={() => toggleLayer("mesoscaleDiscussions")} />
              <span className="atlas-layers-popover__icon"><LayerGlyph visual="mesoscaleDiscussion" /></span>
              Mesoscale Discussions
            </label>
            <label className="atlas-layers-popover__row">
              <input type="checkbox" checked={specialStatementsVisible} onChange={() => toggleLayer("specialStatements")} />
              <span className="atlas-layers-popover__icon"><LayerGlyph visual="specialStatement" /></span>
              Special Statements
            </label>
            <label className="atlas-layers-popover__row">
              <input type="checkbox" checked={mosaicVisible} onChange={() => toggleLayer("mosaic")} />
              <span className="atlas-layers-popover__icon"><LayerGlyph visual="radar" /></span>
              NEXRAD Mosaic
            </label>
            <label className="atlas-layers-popover__row">
              <input type="checkbox" checked={radarVisible} onChange={() => toggleLayer("radar")} />
              <span className="atlas-layers-popover__icon"><LayerGlyph visual="dish" /></span>
              Single-Site Radar
            </label>
            <label className="atlas-layers-popover__row">
              <input type="checkbox" checked={stormReportsVisible} onChange={() => toggleLayer("stormReports")} />
              <span className="atlas-layers-popover__icon"><LayerGlyph visual="warning" /></span>
              Recent Storm Reports - {stormReports.length}
            </label>
            <div className="atlas-layers-popover__section">PEOPLE + FIELD</div>
            <label className="atlas-layers-popover__row">
              <input type="checkbox" checked={teamVisible} onChange={() => toggleLayer("team")} />
              <span className="atlas-layers-popover__icon"><LayerGlyph visual="team" /></span>
              Team
            </label>
            <label className="atlas-layers-popover__row">
              <input type="checkbox" checked={chasersVisible} onChange={() => toggleLayer("chasers")} />
              <span className="atlas-layers-popover__icon"><LayerGlyph visual="spotter" /></span>
              Spotter Network
            </label>
            <label className="atlas-layers-popover__row">
              <input type="checkbox" checked={poiVisible} onChange={() => toggleLayer("poi")} />
              <span className="atlas-layers-popover__icon"><LayerGlyph visual="poi" /></span>
              Nearby (gas / food / hotel / ER)
            </label>
            <label className="atlas-layers-popover__row">
              <input type="checkbox" checked={breadcrumbsVisible} onChange={() => toggleLayer("breadcrumbs")} />
              <span className="atlas-layers-popover__icon"><LayerGlyph visual="trail" /></span>
              Trail
            </label>
            <div className="atlas-layers-popover__section">ROADS + CAMERAS</div>
            <label className="atlas-layers-popover__row">
              <input type="checkbox" checked={roadConditionsVisible} onChange={() => toggleLayer("roadConditions")} />
              <span className="atlas-layers-popover__icon"><LayerGlyph visual="road" /></span>
              {/* setRoadLayerStatus("not-configured") is this layer's OWN idle placeholder for
                  "haven't fetched yet because the toggle is off" -- it reused the same status value
                  a genuinely unconfigured backend returns, which read as "this is broken" for a
                  layer that's simply switched off. Show a plain "off" here instead; once the
                  checkbox is on, the real fetched status (including a real not-configured backend,
                  if that ever happens) renders exactly as before. */}
              Road Conditions - {roadConditionsVisible ? providerStatusLabel(roadLayerStatus, roadConditions.length, roadProviderCount) : "off"}
            </label>
            <label className="atlas-layers-popover__row">
              <input type="checkbox" checked={trafficCamerasVisible} onChange={() => toggleLayer("trafficCameras")} />
              <span className="atlas-layers-popover__icon"><LayerGlyph visual="camera" /></span>
              Public Cameras - {trafficCamerasVisible ? providerStatusLabel(cameraLayerStatus, trafficCameras.length, trafficCameraProviderCount) : "off"}
            </label>
            <label className="atlas-layers-popover__row">
              <input type="checkbox" checked={surfaceStationsVisible} onChange={() => toggleLayer("surfaceStations")} />
              <span className="atlas-layers-popover__icon"><LayerGlyph visual="station" /></span>
              Surface Stations - {surfaceStationsVisible ? providerStatusLabel(surfaceStationLayerStatus, surfaceStations.length, 1) : "off"}
            </label>
            <label className="atlas-layers-popover__row">
              <input type="checkbox" checked={riverGaugesVisible} onChange={() => toggleLayer("riverGauges")} />
              <span className="atlas-layers-popover__icon"><LayerGlyph visual="station" /></span>
              River Gauges - {viewport && viewport.zoom >= 5 ? riverGauges.length : "zoom in"}
            </label>
            <div className="atlas-layers-popover__section">FUTURE</div>
            <label className="atlas-layers-popover__row atlas-layers-popover__row--stub">
              <input type="checkbox" checked={false} disabled onChange={() => undefined} />
              <span className="atlas-layers-popover__icon"><LayerGlyph visual="probe" /></span>
              Probes - unavailable
            </label>
            <label className="atlas-layers-popover__row atlas-layers-popover__row--stub">
              <input type="checkbox" checked={false} disabled onChange={() => undefined} />
              <span className="atlas-layers-popover__icon"><LayerGlyph visual="network" /></span>
              Chaser Net - unavailable
            </label>
          </div>
        )}
        {(visibleError || ATLAS_DIAGNOSTICS_ENABLED) && (
          <div className="map-status atlas-map-status">{visibleError || `${statusLines.join(" - ")} - ${atlasStateLabel}`}</div>
        )}
      </div>
      {/* Reflectivity alone doesn't show rotation -- this row only exists when single-site radar is
          on, since REF/VEL/SRV/CC + tilt are meaningless for the wide-area mosaic. SRV needs a storm
          motion vector or the worker refuses it, so picking SRV without one opens the inline entry
          instead of silently doing nothing. Also hidden outright on a web build with no radar
          worker configured -- a product/tilt picker for a layer that can never actually load a
          frame is just clutter, not a control. */}
      {!compact && radarVisible && !radarWorkerMissingOnWeb() && (
        <div className="atlas-radar-instrument" aria-label="Single-site radar product and tilt">
          <div className="atlas-radar-instrument__heading"><strong>RADAR</strong><span>{radarFrame ? `${radarFrame.site.id}${radarSelectedSite && radarPrimarySite && radarSelectedSite !== radarPrimarySite ? ` · FAILOVER (${radarSiteFailoverReason})` : ""} · FRAME ${radarPlaybackIndex + 1}/${radarFrames.length} · ${new Date(radarFrame.time).toISOString().slice(11, 19)}Z` : "LOADING FRAMES"}</span></div>
          <div className="atlas-radar-instrument__row">
            <select className="atlas-radar-site-select" value={radarSiteOverride} onChange={(event) => chooseRadarSite(event.target.value)} aria-label="Radar site selection" title="Automatic chooses the nearest healthy site and fails over when needed">
              <option value="">AUTO SITE</option>
              {radarNearbySites.map((site) => <option value={site.id} key={site.id}>{site.id} · {site.name}</option>)}
              {radarSiteOverride && !radarNearbySites.some((site) => site.id === radarSiteOverride) && <option value={radarSiteOverride}>{radarSiteOverride} · MANUAL</option>}
            </select>
            {(["REF", "VEL", "SRV", "CC"] as RadarProduct[]).map((product) => (
              <button
                key={product}
                type="button"
                className={radarProduct === product ? "atlas-radar-chip active" : "atlas-radar-chip"}
                onClick={() => {
                  setRadarProduct(product);
                  if (product === "SRV" && !stormMotion) setStormMotionOpen(true);
                }}
              >
                <span className="atlas-radar-chip__swatch" style={{ background: radarSwatchCss(product) }} />
                {product}
              </button>
            ))}
            <button
              type="button"
              className="atlas-radar-chip atlas-radar-chip--tilt"
              aria-label="Cycle radar tilt"
              title={`Elevation cut ${radarTilt} of ${radarAvailableTilts.length} -- cycles to the next tilt`}
              onClick={() => {
                const index = radarAvailableTilts.indexOf(radarTilt);
                const next = radarAvailableTilts[(index + 1) % radarAvailableTilts.length] ?? radarTilt;
                setRadarTilt(next);
              }}
            >
              {radarFrame?.elevationAngle != null ? `${radarFrame.elevationAngle.toFixed(1)}°` : `TILT ${radarTilt}`}
            </button>
            {radarProduct === "SRV" && (
              <button type="button" className={stormMotionOpen ? "atlas-radar-chip active" : "atlas-radar-chip"} onClick={() => setStormMotionOpen((value) => !value)}>
                {stormMotion ? `${Math.round(stormMotion.directionDegrees)}° / ${Math.round(stormMotion.speedKnots)}kt` : "SET MOTION"}
              </button>
            )}
          </div>
          <AtlasRadarLegend product={radarProduct} />
          {radarFrame && (
            <div className={`atlas-radar-instrument__age atlas-radar-instrument__age--${radarFrame.freshness === "STALE" ? "stale" : radarFrame.ageSeconds < 120 ? "live" : "aging"}`}>
              <span className="atlas-radar-instrument__pulse" />
              {radarProduct} · {ageText(radarFrame.ageSeconds)} old{radarFrame.freshness === "STALE" ? " · STALE" : ""}
            </div>
          )}
          {/* Tablet-only (see .atlas-radar-instrument__sensor's media query) -- this is the dash-mounted,
              actively-chasing surface. Phone gets its own separate at-a-glance treatment, not this. */}
          {vehicleWind?.speedMph != null && (
            <div className="atlas-radar-instrument__sensor">
              <span className="atlas-radar-instrument__sensor-label">TRUCK WIND</span>
              <span className="atlas-radar-instrument__sensor-value">
                {Math.round(vehicleWind.speedMph)}mph{vehicleWind.gustMph != null && vehicleWind.gustMph > vehicleWind.speedMph + 3 ? ` G${Math.round(vehicleWind.gustMph)}` : ""}
                {vehicleWind.directionCardinal ? ` FROM ${vehicleWind.directionCardinal}` : vehicleWind.directionDeg != null ? ` @ ${Math.round(vehicleWind.directionDeg)}°` : ""}
              </span>
            </div>
          )}
          {/* Nested in the instrument's own flex column rather than a separately absolutely-positioned
              sibling -- a fixed pixel offset guessing the panel's height above it breaks the moment the
              panel wraps to a second row (CC/SET MOTION chip) or the age line appears/disappears. */}
          {stormMotionOpen && (
            <StormMotionQuickEntry initial={stormMotion} site={radarFrame?.site.id ?? "AUTO"} onApply={applyStormMotion} onClose={() => setStormMotionOpen(false)} />
          )}
        </div>
      )}
      {/* Compact (Weather-page) card: no control row at all -- per the owner's explicit call,
          layer visibility now lives entirely on the Layer Configuration page (reached via the dock
          corner button), not duplicated here. Pan/zoom still work via touch gestures. */}
      {!compact && (
        <div className="map-controls atlas-map-controls" aria-label="Atlas map controls">
          <div className="atlas-map-controls__zoom" aria-label="Map zoom controls">
            <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => mapRef.current?.zoomIn({ duration: 250 })}>+</button>
            <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => mapRef.current?.zoomOut({ duration: 250 })}>−</button>
          </div>
          <button type="button" aria-label="Toggle follow mode" title="Cycles between north-up follow, heading-up follow, and recenter from free pan" className={cameraMode === "FREE" ? "" : "active"} onClick={() => recenter(cameraMode === "FOLLOW_HEADING" ? "FOLLOW_NORTH" : "FOLLOW_HEADING")}>{followLabel}</button>
          <button type="button" aria-label="Export position trail as GPX" title="Downloads your recorded breadcrumb trail as a GPX file" disabled={trail.length === 0} onClick={() => downloadBreadcrumbExport(trail, "gpx")}>EXPORT TRAIL</button>
          <button type="button" aria-label="Clear position trail" title="Clears your recorded breadcrumb trail" disabled={trail.length === 0} onClick={() => clearBreadcrumbTrail()}>CLEAR TRAIL</button>
          <button type="button" aria-label="Toggle zoom lock" title="Stops the camera from re-zooming automatically as your speed changes" className={zoomLocked ? "active" : ""} onClick={() => setZoomLocked((value) => !value)}>ZOOM LOCK</button>
          <button type="button" aria-label="Toggle route ahead hazards" title="Uses the route to the selected map point; falls back to a 20-mile heading corridor" className={routeAheadOnly ? "active" : ""} onClick={() => setRouteAheadOnly((value) => !value)}>AHEAD{routeAheadOnly && navigationRoute.length > 1 ? " · ROUTE" : ""}</button>
          <button type="button" aria-label="Toggle wide-area mosaic layer" title="Wide-area national radar mosaic, auto-refreshing" className={mosaicVisible ? "active" : ""} onClick={() => toggleLayer("mosaic")}>MOSAIC</button>
          <button type="button" aria-label="Map layers" data-testid="atlas-map-layers-primary" title="Toggle alerts, team, chaser, and gas/food POI pins" className={layersPopoverOpen ? "active" : ""} onClick={() => setLayersPopoverOpen((value) => !value)}>LAYERS</button>
        </div>
      )}
    </div>
  );
}

// Storm-relative velocity is useless without a motion vector, and typing exact numbers mid-chase is
// unrealistic -- AUTO pulls a real centroid-tracked estimate from the worker (see estimateStormMotion
// in radar-worker/worker.cjs) so the driver doesn't have to compute or type anything; the compass/
// number fields stay for correcting it or entering a SPC-mesoanalysis-informed value by hand.
function StormMotionQuickEntry({
  initial,
  site,
  onApply,
  onClose,
}: {
  initial: StormMotion | null;
  site: string;
  onApply: (directionDegrees: number, speedKnots: number) => void;
  onClose: () => void;
}) {
  const [direction, setDirection] = useState(initial?.directionDegrees ?? 225);
  const [speed, setSpeed] = useState(initial?.speedKnots ?? 30);
  const [autoState, setAutoState] = useState<"idle" | "loading" | "ok" | "failed">("idle");
  const [autoDetail, setAutoDetail] = useState("");
  const compassPoints: Array<[string, number]> = [
    ["N", 0], ["NE", 45], ["E", 90], ["SE", 135],
    ["S", 180], ["SW", 225], ["W", 270], ["NW", 315],
  ];
  const runAuto = async () => {
    setAutoState("loading");
    const estimate = await getStormMotionEstimate(site);
    if (!estimate.ok || estimate.directionDegrees == null || estimate.speedKnots == null) {
      setAutoState("failed");
      setAutoDetail(
        estimate.reason === "NEED_TWO_REF_FRAMES" ? `Need REF history (${estimate.framesAvailable ?? 0}/2 frames)`
        : estimate.reason === "NO_SIGNIFICANT_ECHO" ? "No storm strong enough to track nearby"
        : estimate.reason === "WORKER_NOT_CONFIGURED" ? "Radar worker not configured"
        : "Couldn't estimate -- enter manually",
      );
      return;
    }
    setDirection(estimate.directionDegrees);
    setSpeed(estimate.speedKnots);
    setAutoState("ok");
    setAutoDetail(`${estimate.confidence} confidence -- ${estimate.sampleSpanMinutes}min sample`);
  };
  return (
    <div className="atlas-storm-motion-entry" role="dialog" aria-label="Set storm motion for SRV">
      <div className="atlas-storm-motion-entry__row">
        <span>STORM MOTION (FROM)</span>
        <button type="button" aria-label="Close storm motion entry" onClick={onClose}>Close</button>
      </div>
      <button type="button" className={`atlas-storm-motion-entry__auto${autoState === "loading" ? " atlas-storm-motion-entry__auto--scanning" : ""}`} onClick={() => void runAuto()} disabled={autoState === "loading"}>
        {autoState === "loading" ? "TRACKING STORM..." : "AUTO-ESTIMATE FROM RADAR"}
      </button>
      {autoDetail && <div className={`atlas-storm-motion-entry__auto-detail atlas-storm-motion-entry__auto-detail--${autoState}`}>{autoDetail}</div>}
      <div className="atlas-storm-motion-entry__compass">
        {compassPoints.map(([label, deg]) => (
          <button key={label} type="button" className={direction === deg ? "active" : ""} onClick={() => setDirection(deg)}>{label}</button>
        ))}
      </div>
      <div className="atlas-storm-motion-entry__row">
        <label>
          Dir
          <input type="number" min={0} max={359} value={Math.round(direction)} onChange={(event) => setDirection(Number(event.target.value) || 0)} />°
        </label>
        <label>
          Speed
          <input type="number" min={0} max={80} value={Math.round(speed)} onChange={(event) => setSpeed(Number(event.target.value) || 0)} />kt
        </label>
        <button type="button" onClick={() => onApply(direction, speed)}>Apply</button>
      </div>
    </div>
  );
}
