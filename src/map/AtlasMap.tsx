import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { atlasStyleUri, hasMapboxToken, mapboxAccessToken, writeMapRuntimeDiagnostics } from "../services/mapTiles";
import type { RadarFrame, RadarProduct } from "../services/radar";
import { getRadarMosaicFrames, type AlertProduct } from "../services/situational";
import type { Spotter } from "../services/spotters";
import type { NearbyPlace } from "../services/nearby";
import { resolveTeamPositions } from "../services/teamPositions";
import { clearBreadcrumbTrail, recordBreadcrumbPoint } from "../services/breadcrumbTrail";
import { DEFAULT_CHASER_RADIUS_MILES, loadChaserRadiusMiles, loadMapLayerVisibility, subscribeChaserRadiusMiles, subscribeMapLayerVisibility, saveMapLayerVisibility } from "../services/settings";
import { useBreadcrumbTrail } from "../hooks/useBreadcrumbTrail";
import { useTeamRoster } from "../hooks/useTeamRoster";
import { useCustomPoiPins } from "../hooks/useCustomPoiPins";
import { useChaserPinStyle, useTeamPinStyle, useVehicleMarkerStyle } from "../hooks/usePinStyle";
import { applyAtlasCamera, zoomForSpeed } from "./AtlasCameraController";
import { atlasLifecycleCounters, atlasMapInstanceCount, decrementAtlasMapInstances, incrementAtlasCounter, incrementAtlasMapInstances, writeAtlasDiagnostics } from "./AtlasDiagnostics";
import { updateAtlasAlertsLayer } from "./AtlasAlertsLayer";
import { updateAtlasBreadcrumbLayer } from "./AtlasBreadcrumbLayer";
import { startAtlasMosaicAnimation } from "./AtlasMosaicLayer";
import { updateAtlasPoiLayer } from "./AtlasPoiLayer";
import { updateAtlasRadarLayer, ATLAS_RADAR_LAYER, ATLAS_RADAR_SOURCE } from "./AtlasRadarLayer";
import { updateAtlasRangeRings } from "./AtlasRangeRingLayer";
import { updateAtlasSpotterLayer } from "./AtlasSpotterLayer";
import { tuneAtlasStyle } from "./AtlasStyleManager";
import { updateAtlasTeamLayer } from "./AtlasTeamLayer";
import { startAtlasVehiclePulse, updateAtlasVehicleLayer } from "./AtlasVehicleLayer";
import { updateAtlasWatchesLayer } from "./AtlasWatchesLayer";
import type { AtlasCameraMode, AtlasGpsPoint, AtlasMapState, AtlasRadarState, AtlasRangeRingMode } from "./types";
import { getActiveWatchPolygons, type WatchPolygon } from "../services/watches";

const INTRO_START_ZOOM = 4.5; // Wide establishing shot -- the initial flyTo (below) eases down to
// the real operating zoom for a "swoop to position" open on cold launch, rather than snapping.
const INTRO_DURATION_MS = 2800;
const MOSAIC_REFRESH_MS = 10 * 60_000; // RainViewer's public frames update roughly every 10 min.
const WATCHES_REFRESH_MS = 5 * 60_000; // Watches are issued/canceled far less often than radar
// updates, but a new one mid-chase matters -- 5 min keeps this current without hammering NWS's
// service.
// Owner-specified: manually moving the map pauses auto-follow and the mosaic loop for 2 minutes,
// then both resume on their own -- long enough to actually look at something without fighting the
// vehicle's own movement, short enough that walking away doesn't strand the map wherever it was left.
const INTERACTION_PAUSE_MS = 2 * 60_000;

type AtlasMapProps = {
  gps: AtlasGpsPoint | null;
  frame: RadarFrame | null;
  product: RadarProduct;
  opacity: number;
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
  onRangeRingsChange: (mode: AtlasRangeRingMode) => void;
  onOpenExpanded?: () => void;
  statusLines: string[];
  alerts?: AlertProduct[];
  spotters?: Spotter[];
  poiPlaces?: NearbyPlace[];
  // "compact" is the Weather-page card: owner asked for mosaic + layer visibility only, no zoom/
  // north-up/rings/clear-trail/mosaic-toggle buttons and no single-site radar UI at all -- that
  // full toolbar only exists on the "full" Locate page, which has the room for it.
  controlsVariant?: "full" | "compact";
};

const EMPTY_MODIFIERS = { modifiedLayers: 0, firstSymbolLayerId: undefined as string | undefined, lastMapError: "" };
// Stable references for the default-prop case -- a fresh `[]` literal in the destructured default
// would otherwise be recreated on every render, changing identity and re-firing every effect keyed
// off `alerts`/`spotters` even though nothing actually changed.
const EMPTY_ALERTS: AlertProduct[] = [];
const EMPTY_SPOTTERS: Spotter[] = [];
const EMPTY_POI: NearbyPlace[] = [];
const ATLAS_STYLE_TUNING_DISABLED = import.meta.env.VITE_ATLAS_DISABLE_STYLE_TUNE === "1";
const ATLAS_DIAGNOSTICS_ENABLED = import.meta.env.VITE_ATLAS_DIAGNOSTICS === "1";
const GPS_REFRESH_MAX_AGE_MS = 5_000;
const GPS_MIN_MOVE_METERS = 4;
const GPS_MIN_HEADING_DEG = 5;
const GPS_MIN_SPEED_MPH = 1;
const GPS_MIN_ACCURACY_M = 5;

function rangeRingNext(mode: AtlasRangeRingMode): AtlasRangeRingMode {
  if (mode === "off") return "10";
  if (mode === "10") return "25";
  if (mode === "25") return "50";
  if (mode === "50") return "100";
  return "off";
}

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

export function AtlasMap({
  gps,
  frame,
  product,
  opacity,
  expanded = false,
  active = true,
  rangeRings,
  onRangeRingsChange,
  onOpenExpanded,
  statusLines,
  alerts = EMPTY_ALERTS,
  spotters = EMPTY_SPOTTERS,
  poiPlaces = EMPTY_POI,
  controlsVariant = "full",
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
  const latestRef = useRef({ gps, frame, opacity, rangeRings, expanded });
  const [cameraMode, setCameraMode] = useState<AtlasCameraMode>("FOLLOW_NORTH");
  const [bearing, setBearing] = useState(gps?.headingDeg ?? 0);
  const [pitch, setPitch] = useState(0);
  const [mapError, setMapError] = useState("");
  const [radarError, setRadarError] = useState("");
  const [mapState, setMapState] = useState<AtlasMapState>("INITIALIZING");
  const [radarState, setRadarState] = useState<AtlasRadarState>("LOADING");
  const [renderCount, setRenderCount] = useState(0);
  const [idleCount, setIdleCount] = useState(0);
  const [pixelSample, setPixelSample] = useState("pending");
  const renderCountRef = useRef(0);
  const idleCountRef = useRef(0);
  const lastGpsAppliedRef = useRef<{ gps: AtlasGpsPoint; at: number } | null>(null);
  const stopPulseRef = useRef<(() => void) | null>(null);
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
  const [layerVisibility, setLayerVisibility] = useState({ alerts: true, team: true, chasers: true, poi: true, mosaic: true });
  useEffect(() => {
    const unsubscribe = subscribeMapLayerVisibility(setLayerVisibility);
    void loadMapLayerVisibility();
    return () => { unsubscribe(); };
  }, []);
  const { alerts: alertsVisible, team: teamVisible, chasers: chasersVisible, poi: poiVisible, mosaic: mosaicVisible } = layerVisibility;
  const toggleLayer = (key: keyof typeof layerVisibility) => {
    void saveMapLayerVisibility({ ...layerVisibility, [key]: !layerVisibility[key] });
  };
  const mosaicVisibleRef = useRef(mosaicVisible);
  const mosaicFramesRef = useRef<string[]>([]);
  mosaicVisibleRef.current = mosaicVisible;
  const [watches, setWatches] = useState<WatchPolygon[]>([]);
  const [layersPopoverOpen, setLayersPopoverOpen] = useState(false);
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
    return spotters.filter((spotter) => !teamIds.has(spotter.id) && spotter.distanceMiles <= chaserRadiusMiles);
  }, [spotters, teamPositions, chaserRadiusMiles]);

  latestRef.current = { gps, frame, opacity, rangeRings, expanded };

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

      const markUserInteraction = (event: unknown) => {
        const originalEvent = typeof event === "object" && event !== null && "originalEvent" in event ? (event as { originalEvent?: Event }).originalEvent : undefined;
        if (!originalEvent) return;
        setCameraMode("USER_INTERACTING");
        // Actively dragging counts as "paused" indefinitely -- the real 2-minute countdown starts
        // once they let go (markFree), not while their finger/mouse is still on the map.
        if (interactionResumeTimerRef.current != null) {
          window.clearTimeout(interactionResumeTimerRef.current);
          interactionResumeTimerRef.current = null;
        }
        interactionResumeAtRef.current = Infinity;
      };
      const markFree = () => {
        setCameraMode((mode) => mode === "USER_INTERACTING" ? "FREE" : mode);
        interactionResumeAtRef.current = Date.now() + INTERACTION_PAUSE_MS;
        if (interactionResumeTimerRef.current != null) window.clearTimeout(interactionResumeTimerRef.current);
        interactionResumeTimerRef.current = window.setTimeout(() => {
          interactionResumeAtRef.current = 0;
          interactionResumeTimerRef.current = null;
          recenterRef.current(autoModeRef.current);
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
      map.getCanvas().addEventListener("webglcontextlost", () => {
        setMapState("WEBGL_ERROR");
        setMapError("WEBGL_CONTEXT_LOST");
      });
      map.on("error", (event) => {
        setMapState("STYLE_ERROR");
        setMapError(event.error?.message ?? "MAPBOX_GL_ERROR");
      });
      const initializeStyle = () => {
        if (styleInitializedRef.current || !map.isStyleLoaded()) return;
        styleInitializedRef.current = true;
        incrementAtlasCounter("styleLoads");
        const latest = latestRef.current;
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
        stopPulseRef.current = startAtlasVehiclePulse(map, () => activeRef.current);
        stopMosaicRef.current = startAtlasMosaicAnimation(
          map,
          () => mosaicFramesRef.current,
          () => mosaicVisibleRef.current && activeRef.current,
          styleInfoRef.current.firstSymbolLayerId,
          () => Date.now() < interactionResumeAtRef.current,
        );
        const radar = updateAtlasRadarLayer(map, latest.frame, latest.opacity, styleInfoRef.current.firstSymbolLayerId);
        setRadarState(radar.state);
        if (!radar.loaded && radar.error) setRadarError(radar.error);
        else setRadarError("");
        updateAtlasRangeRings(map, latest.frame?.site ?? null, latest.rangeRings);
      };
      map.on("load", initializeStyle);
      map.on("style.load", initializeStyle);
      map.on("idle", initializeStyle);
    } catch (error) {
      setMapError(error instanceof Error ? error.message : "MAPBOX_GL_INIT_FAILED");
      setMapState("STYLE_ERROR");
    }

    return () => {
      stopPulseRef.current?.();
      stopPulseRef.current = null;
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
    recordBreadcrumbPoint(gps.lat, gps.lon);
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
    setCameraMode("FOLLOW_NORTH");
  }, [loaded, gps, expanded, compact]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    window.setTimeout(() => map.resize(), 80);
  }, [expanded, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !gps) return;
    const now = Date.now();
    if (!shouldApplyGpsUpdate(lastGpsAppliedRef.current, gps, now)) return;
    lastGpsAppliedRef.current = { gps, at: now };
    updateAtlasVehicleLayer(map, gps, vehicleMarkerStyleRef.current);
    recordBreadcrumbPoint(gps.lat, gps.lon, now);
    // Skip the actual camera move when this instance isn't the one on screen -- the vehicle marker
    // and breadcrumb above still stay current, so there's no stale-position catch-up animation when
    // the user swipes back to this page, but the expensive easeTo (and the render/GPU work it
    // drives) isn't spent on a canvas nobody's looking at right now.
    if (!activeRef.current) return;
    if (cameraMode === "FOLLOW_NORTH" || cameraMode === "FOLLOW_HEADING" || cameraMode === "RECENTERING") {
      const camera = applyAtlasCamera(map, gps, cameraMode, expanded, bearing, compact);
      setBearing(camera.bearing);
      setPitch(camera.pitch);
    }
  }, [bearing, cameraMode, expanded, gps, loaded, compact]);

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
      zoom: zoomForSpeed(gps.speedMph, expanded, compact),
      bearing,
      pitch,
      duration: 600,
      easing: (t) => 1 - (1 - t) ** 3,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only meant to fire on the active edge
  }, [active]);

  // A vehicle marker style change from Settings is a rare, deliberate user action, not GPS noise --
  // repaint immediately rather than waiting for the throttled GPS-update effect above to next fire.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !gps) return;
    updateAtlasVehicleLayer(map, gps, vehicleMarkerStyle);
  }, [vehicleMarkerStyle, loaded]);

  // Breadcrumb trail is a Locate-page driving aid (with its own Clear Trail button there) -- not a
  // togglable Layers-page item, and not part of "the dashboard shows only what's configured." The
  // compact Weather card never rendered a trail-clearing control, so a trail was quietly building up
  // there with zero user control; simplest fix is to just not draw it on the compact instance at all.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    updateAtlasBreadcrumbLayer(map, compact ? [] : trail);
  }, [loaded, trail, compact]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    updateAtlasAlertsLayer(map, alerts, alertsVisible, styleInfoRef.current.firstSymbolLayerId);
  }, [alerts, alertsVisible, loaded]);

  useEffect(() => {
    if (!alertsVisible) return;
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
  }, [alertsVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    updateAtlasWatchesLayer(map, watches, alerts, alertsVisible, styleInfoRef.current.firstSymbolLayerId);
  }, [watches, alerts, alertsVisible, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    updateAtlasTeamLayer(map, teamPositions, teamPinStyle, teamVisible);
  }, [teamPositions, teamPinStyle, teamVisible, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    updateAtlasSpotterLayer(map, chaserSpotters, chaserPinStyle, chasersVisible);
  }, [chaserSpotters, chaserPinStyle, chasersVisible, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    updateAtlasPoiLayer(map, poiPlaces, customPoiPins, poiVisible);
  }, [poiPlaces, customPoiPins, poiVisible, loaded]);

  useEffect(() => {
    if (!mosaicVisible) return;
    let cancelled = false;
    const load = async () => {
      const frames = await getRadarMosaicFrames();
      if (!cancelled && frames.length > 0) mosaicFramesRef.current = frames;
    };
    void load();
    const timer = window.setInterval(load, MOSAIC_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [mosaicVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const radar = updateAtlasRadarLayer(map, frame, opacity, styleInfoRef.current.firstSymbolLayerId);
    setRadarState(radar.state);
    if (!radar.loaded && radar.error) setRadarError(radar.error);
    else setRadarError("");
  }, [frame, loaded, opacity]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    updateAtlasRangeRings(map, frame?.site ?? null, rangeRings);
  }, [frame?.site, loaded, rangeRings]);

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
      radarState,
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
      selectedProduct: product,
      radarSourceLoaded: Boolean(map?.getSource(ATLAS_RADAR_SOURCE)),
      radarLayerLoaded: Boolean(map?.getLayer(ATLAS_RADAR_LAYER)),
      radarOpacity: opacity,
      radarBounds: frame?.bounds ?? null,
      radarFrameId: frame?.frameId ?? null,
      radarImageUrlType: frame?.imageUrl?.startsWith("blob:") ? "blob" : frame?.imageUrl?.startsWith("http") ? "http" : frame?.imageUrl?.startsWith("capacitor:") ? "capacitor" : frame?.imageUrl?.startsWith("/") ? "asset" : frame?.imageUrl ? "other" : "none",
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
      lastMapError: mapError || radarError || styleInfoRef.current.lastMapError,
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
      radarOpacity: opacity,
      product,
      provider: "mapbox",
      updatedAt: Date.now(),
    });
  }, [bearing, cameraMode, frame?.bounds, frame?.frameId, frame?.imageUrl, gps, idleCount, loaded, mapError, mapState, opacity, pitch, pixelSample, product, radarError, radarState, renderCount, styleUri]);

  const visibleError = mapError && mapState !== "READY" ? mapError : "";
  const canvasCount = containerRef.current?.querySelectorAll("canvas").length ?? 0;
  const atlasStateLabel = ATLAS_DIAGNOSTICS_ENABLED
    ? `${mapState}${loaded ? "" : " LOADING"} c${canvasCount} r${renderCount} i${idleCount} ${pixelSample}`
    : `${mapState}${loaded ? "" : " LOADING"}`;

  const followLabel = cameraMode === "FOLLOW_HEADING" ? "HEADING UP" : cameraMode === "FREE" ? "RECENTER" : "NORTH UP";

  return (
    <div className="atlas-map-shell">
      <div className="atlas-map-canvas-area">
        <div ref={containerRef} className="atlas-map" data-camera-mode={cameraMode} />
        {visibleError && <div className="atlas-map-error">{visibleError}</div>}
        {!compact && (
          <div className="radar-strip atlas-radar-strip">
            {statusLines.map((line, index) => <span key={index}>{line}</span>)}
          </div>
        )}
        {onOpenExpanded && (
          <button type="button" className="atlas-expand-button" aria-label="Expand radar" onClick={(event) => { event.stopPropagation(); onOpenExpanded(); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6" /></svg>
          </button>
        )}
        {layersPopoverOpen && (
          <div className="atlas-layers-popover" role="dialog" aria-label="Map layers">
            <div className="atlas-layers-popover__title">Layers</div>
            <label className="atlas-layers-popover__row">
              <input type="checkbox" checked={alertsVisible} onChange={() => toggleLayer("alerts")} />
              Alerts (watches + warnings + MD)
            </label>
            <label className="atlas-layers-popover__row">
              <input type="checkbox" checked={teamVisible} onChange={() => toggleLayer("team")} />
              Team
            </label>
            <label className="atlas-layers-popover__row">
              <input type="checkbox" checked={chasersVisible} onChange={() => toggleLayer("chasers")} />
              Chasers
            </label>
            <label className="atlas-layers-popover__row">
              <input type="checkbox" checked={poiVisible} onChange={() => toggleLayer("poi")} />
              Gas / Food
            </label>
          </div>
        )}
        {(visibleError || ATLAS_DIAGNOSTICS_ENABLED) && (
          <div className="map-status atlas-map-status">{visibleError || `${statusLines.join(" - ")} - ${atlasStateLabel}`}</div>
        )}
      </div>
      {/* Compact (Weather-page) card: no control row at all -- per the owner's explicit call,
          layer visibility now lives entirely on the Layer Configuration page (reached via the dock
          corner button), not duplicated here. Pan/zoom still work via touch gestures. */}
      {!compact && (
        <div className="map-controls atlas-map-controls" aria-label="Atlas map controls">
          <button type="button" aria-label="Zoom in" onClick={() => mapRef.current?.easeTo({ zoom: (mapRef.current?.getZoom() ?? 8) + 0.5, duration: 260 })}>ZOOM+</button>
          <button type="button" aria-label="Zoom out" onClick={() => mapRef.current?.easeTo({ zoom: (mapRef.current?.getZoom() ?? 8) - 0.5, duration: 260 })}>ZOOM−</button>
          <button type="button" aria-label="Toggle follow mode" title="Cycles between North-up, Heading-up, and Recenter" onClick={() => recenter(cameraMode === "FOLLOW_HEADING" ? "FOLLOW_NORTH" : "FOLLOW_HEADING")}>{followLabel}</button>
          <button type="button" aria-label="Toggle range rings" title="Distance rings around your position" onClick={() => onRangeRingsChange(rangeRingNext(rangeRings))}>RINGS{rangeRings !== "off" ? ` ${rangeRings}NM` : ""}</button>
          <button type="button" aria-label="Clear position trail" title="Clears your recorded breadcrumb trail" disabled={trail.length === 0} onClick={() => clearBreadcrumbTrail()}>CLEAR TRAIL</button>
          <button type="button" aria-label="Toggle wide-area mosaic layer" title="Wide-area national radar mosaic, animated" className={mosaicVisible ? "active" : ""} onClick={() => toggleLayer("mosaic")}>MOSAIC</button>
          <button type="button" aria-label="Map layers" title="Toggle alerts, team, chaser, and gas/food POI pins" className={layersPopoverOpen ? "active" : ""} onClick={() => setLayersPopoverOpen((value) => !value)}>LAYERS</button>
        </div>
      )}
    </div>
  );
}
