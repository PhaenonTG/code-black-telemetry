import { useCallback, useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { atlasStyleUri, hasMapboxToken, mapboxAccessToken, writeMapRuntimeDiagnostics } from "../services/mapTiles";
import type { RadarFrame, RadarProduct } from "../services/radar";
import { applyAtlasCamera } from "./AtlasCameraController";
import { atlasLifecycleCounters, atlasMapInstanceCount, decrementAtlasMapInstances, incrementAtlasCounter, incrementAtlasMapInstances, writeAtlasDiagnostics } from "./AtlasDiagnostics";
import { updateAtlasRadarLayer, ATLAS_RADAR_LAYER, ATLAS_RADAR_SOURCE } from "./AtlasRadarLayer";
import { updateAtlasRangeRings } from "./AtlasRangeRingLayer";
import { tuneAtlasStyle } from "./AtlasStyleManager";
import { updateAtlasVehicleLayer } from "./AtlasVehicleLayer";
import type { AtlasCameraMode, AtlasGpsPoint, AtlasMapState, AtlasRadarState, AtlasRangeRingMode } from "./types";

type AtlasMapProps = {
  gps: AtlasGpsPoint | null;
  frame: RadarFrame | null;
  product: RadarProduct;
  opacity: number;
  expanded?: boolean;
  rangeRings: AtlasRangeRingMode;
  onRangeRingsChange: (mode: AtlasRangeRingMode) => void;
  onOpenExpanded?: () => void;
  statusLabel: string;
  scanLabel: string;
};

const EMPTY_MODIFIERS = { modifiedLayers: 0, firstSymbolLayerId: undefined as string | undefined, lastMapError: "" };
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
  rangeRings,
  onRangeRingsChange,
  onOpenExpanded,
  statusLabel,
  scanLabel,
}: AtlasMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const styleInfoRef = useRef(EMPTY_MODIFIERS);
  const styleInitializedRef = useRef(false);
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
  const [loaded, setLoaded] = useState(false);
  const styleUri = atlasStyleUri();

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
    setCameraMode("RECENTERING");
    const camera = applyAtlasCamera(map, gps, mode, expanded, bearing);
    setBearing(camera.bearing);
    setPitch(camera.pitch);
    window.setTimeout(() => setCameraMode(mode), 650);
  }, [bearing, expanded, gps]);

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
        zoom: initial.expanded ? 8.8 : 8,
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
      };
      const markFree = () => setCameraMode((mode) => mode === "USER_INTERACTING" ? "FREE" : mode);
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
        if (latest.gps) {
          updateAtlasVehicleLayer(map, latest.gps);
          const camera = applyAtlasCamera(map, latest.gps, "FOLLOW_NORTH", latest.expanded, latest.gps.headingDeg ?? 0);
          setBearing(camera.bearing);
          setPitch(camera.pitch);
          setCameraMode("FOLLOW_NORTH");
        }
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
      const map = mapRef.current;
      if (map) {
        map.remove();
        incrementAtlasCounter("mapRemoves");
        decrementAtlasMapInstances();
      }
      mapRef.current = null;
    };
  }, [styleUri]);

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
    updateAtlasVehicleLayer(map, gps);
    if (cameraMode === "FOLLOW_NORTH" || cameraMode === "FOLLOW_HEADING" || cameraMode === "RECENTERING") {
      const camera = applyAtlasCamera(map, gps, cameraMode, expanded, bearing);
      setBearing(camera.bearing);
      setPitch(camera.pitch);
    }
  }, [bearing, cameraMode, expanded, gps, loaded]);

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
  const radarStatus = radarError || (radarState === "FRAME_MISSING" ? "NO RADAR FRAME" : radarState.replace(/_/g, " "));
  const atlasStateLabel = ATLAS_DIAGNOSTICS_ENABLED
    ? `${mapState}${loaded ? "" : " LOADING"} c${canvasCount} r${renderCount} i${idleCount} ${pixelSample}`
    : `${mapState}${loaded ? "" : " LOADING"}`;

  return (
    <div className="atlas-map-shell">
      <div ref={containerRef} className="atlas-map" data-camera-mode={cameraMode} />
      {visibleError && <div className="atlas-map-error">{visibleError}</div>}
      <div className="radar-strip atlas-radar-strip">
        <span>{frame ? `${frame.site.id}  - ${frame.sourceLevel}  - ${frame.freshness}` : "ATLAS MAPBOX GL"}</span>
        <em>{scanLabel}</em>
        {onOpenExpanded && <button type="button" onClick={(event) => { event.stopPropagation(); onOpenExpanded(); }}>OPEN</button>}
      </div>
      <div className="map-controls atlas-map-controls" aria-label="Atlas map controls">
        <button type="button" aria-label="Zoom in" onClick={() => mapRef.current?.easeTo({ zoom: (mapRef.current?.getZoom() ?? 8) + 0.5, duration: 260 })}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => mapRef.current?.easeTo({ zoom: (mapRef.current?.getZoom() ?? 8) - 0.5, duration: 260 })}>-</button>
        <button type="button" aria-label="Toggle follow mode" onClick={() => recenter(cameraMode === "FOLLOW_HEADING" ? "FOLLOW_NORTH" : "FOLLOW_HEADING")}>{cameraMode === "FOLLOW_HEADING" ? "HDG" : cameraMode === "FREE" ? "REC" : "NUP"}</button>
        <button type="button" aria-label="Toggle range rings" onClick={() => onRangeRingsChange(rangeRingNext(rangeRings))}>RNG</button>
      </div>
      <div className="map-status atlas-map-status">{visibleError || `${statusLabel}  - ${radarStatus}  - ${atlasStateLabel}`}</div>
    </div>
  );
}
