export type AtlasCameraMode = "FREE" | "FOLLOW_NORTH" | "FOLLOW_HEADING" | "RECENTERING" | "USER_INTERACTING";

export type AtlasGpsPoint = {
  lat: number;
  lon: number;
  headingDeg: number | null;
  speedMph?: number | null;
  accuracyM?: number | null;
};

export type AtlasRangeRingMode = "off" | "10" | "25" | "50" | "100";

export type AtlasMapState = "INITIALIZING" | "READY" | "STYLE_ERROR" | "WEBGL_ERROR" | "TOKEN_MISSING" | "CONTAINER_INVALID";

export type AtlasRadarState = "FRAME_MISSING" | "IMAGE_MISSING" | "BOUNDS_INVALID" | "CACHED" | "STALE" | "LIVE";

export type AtlasLifecycleCounters = {
  reactMounts: number;
  reactUnmounts: number;
  mapConstructors: number;
  mapRemoves: number;
  styleLoads: number;
  sourceCreations: number;
  layerCreations: number;
  sourceUpdates: number;
  radarImageUpdates: number;
};

export type AtlasDiagnosticsSnapshot = {
  renderer: "mapbox-gl-js";
  engine: "atlas";
  mapboxVersion: string;
  styleUri: string;
  styleLoaded: boolean;
  mapState: AtlasMapState;
  mapInitialized: boolean;
  mapInstanceCount: number;
  canvasCount: number;
  webglContextCount: number;
  lifecycle: AtlasLifecycleCounters;
  cameraMode: AtlasCameraMode;
  zoom: number;
  bearing: number;
  pitch: number;
  center: { lat: number; lon: number } | null;
  gps: AtlasGpsPoint | null;
  mosaicVisible: boolean;
  radarLayerLoaded: boolean;
  canvas: { cssWidth: number; cssHeight: number; backingWidth: number; backingHeight: number; devicePixelRatio: number } | null;
  canvasPixelSample: string;
  sourceCount: number;
  layerCount: number;
  lastMapError: string;
  fallbackState: string;
  updatedAt: number;
};
