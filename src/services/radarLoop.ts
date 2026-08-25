import type { RadarFrame, RadarProduct } from "./radar";

export type RadarPlaybackState = "PAUSED" | "PLAYING" | "HISTORICAL" | "LIVE_EDGE" | "NO_HISTORY" | "ERROR";

export type RadarPlaybackSpeed = 0.5 | 1 | 2;

export interface RadarFrameRecord {
  frameId: string;
  radarSite: string;
  product: RadarProduct;
  scanTimestamp: string;
  receivedTimestamp: string | null;
  sourceType: string;
  imageUrl: string | null;
  bounds: RadarFrame["bounds"] | null;
  elevationAngle: number | null;
  cacheState: RadarFrame["freshness"];
  fileSizeBytes: number | null;
  pixelDimensions: { width: number; height: number } | null;
  validityState: "VALID" | "IMAGE_MISSING" | "BOUNDS_MISSING" | "TIME_INVALID";
  frame: RadarFrame;
}

export interface RadarFrameSeries {
  selectedProduct: RadarProduct;
  frames: RadarFrameRecord[];
  activeFrameIndex: number;
  newestFrameIndex: number;
  oldestFrameIndex: number;
  playbackState: RadarPlaybackState;
  playbackSpeed: RadarPlaybackSpeed;
  loopingEnabled: boolean;
  liveEdge: boolean;
  loadStatus: "READY" | "EMPTY" | "LOADING" | "ERROR";
  missingFrameInformation: string;
}

export interface RadarLoopDiagnostics {
  loopEnabled: boolean;
  playbackState: RadarPlaybackState;
  playbackSpeed: RadarPlaybackSpeed;
  selectedProduct: RadarProduct;
  frameCount: number;
  activeFrameIndex: number;
  newestScanTimestamp: string | null;
  oldestScanTimestamp: string | null;
  activeScanTimestamp: string | null;
  activeFrameAgeSeconds: number | null;
  liveEdge: boolean;
  cacheDirectory: string;
  cacheDiskUsageBytes: number | null;
  objectUrlCount: number;
  imageLoadRequestId: number;
  sourceUpdateCount: number;
  staleUpdateRejectionCount: number;
  activeTextureEstimateBytes: number | null;
  lastPlaybackError: string;
  lastCacheError: string;
  skippedInvalidFrames: number;
  updatedAt: number;
}

const LOOP_DIAGNOSTICS_KEY = "codeblack.radar.loop.diagnostics";
const MAX_FRAME_HISTORY = 12;

function scanTime(frame: RadarFrame) {
  const value = Date.parse(frame.time);
  return Number.isFinite(value) ? value : 0;
}

function recordValidity(frame: RadarFrame): RadarFrameRecord["validityState"] {
  if (!Number.isFinite(scanTime(frame))) return "TIME_INVALID";
  if (frame.tileTemplate) return "VALID";
  if (!frame.imageUrl) return "IMAGE_MISSING";
  if (!frame.bounds) return "BOUNDS_MISSING";
  return "VALID";
}

export function normalizeRadarFrames(frames: RadarFrame[], maxFrames = MAX_FRAME_HISTORY) {
  const byTimestamp = new Map<string, RadarFrame>();
  for (const frame of frames) {
    if (!frame?.frameId || !frame.time) continue;
    const key = `${frame.product}:${frame.site.id}:${frame.time}:${frame.elevationAngle ?? "tilt"}`;
    const existing = byTimestamp.get(key);
    if (!existing || scanTime(frame) > scanTime(existing)) byTimestamp.set(key, frame);
  }
  return [...byTimestamp.values()]
    .sort((a, b) => scanTime(b) - scanTime(a))
    .slice(0, maxFrames);
}

export function buildFrameSeries(
  product: RadarProduct,
  frames: RadarFrame[],
  activeFrameId: string | null,
  playbackState: RadarPlaybackState,
  playbackSpeed: RadarPlaybackSpeed,
): RadarFrameSeries {
  const normalized = normalizeRadarFrames(frames);
  const records = normalized.map((frame) => ({
    frameId: frame.frameId,
    radarSite: frame.site.id,
    product: frame.product,
    scanTimestamp: frame.time,
    receivedTimestamp: null,
    sourceType: frame.sourceLevel,
    imageUrl: frame.imageUrl ?? null,
    bounds: frame.bounds ?? null,
    elevationAngle: frame.elevationAngle,
    cacheState: frame.freshness,
    fileSizeBytes: null,
    pixelDimensions: null,
    validityState: recordValidity(frame),
    frame,
  }));
  const activeFrameIndex = Math.max(0, records.findIndex((item) => item.frameId === activeFrameId));
  const resolvedIndex = records.length ? (activeFrameIndex === -1 ? 0 : activeFrameIndex) : -1;
  const invalidCount = records.filter((item) => item.validityState !== "VALID").length;
  const liveEdge = resolvedIndex === 0 && records.length > 0;
  return {
    selectedProduct: product,
    frames: records,
    activeFrameIndex: resolvedIndex,
    newestFrameIndex: records.length ? 0 : -1,
    oldestFrameIndex: records.length ? records.length - 1 : -1,
    playbackState: records.length === 0 ? "NO_HISTORY" : playbackState === "PLAYING" ? "PLAYING" : liveEdge ? "LIVE_EDGE" : "HISTORICAL",
    playbackSpeed,
    loopingEnabled: records.length > 1,
    liveEdge,
    loadStatus: records.length ? "READY" : "EMPTY",
    missingFrameInformation: invalidCount ? `${invalidCount} invalid frame${invalidCount === 1 ? "" : "s"} skipped by renderer` : "",
  };
}

export function playbackDelayMs(speed: RadarPlaybackSpeed) {
  if (speed === 0.5) return 1800;
  if (speed === 2) return 450;
  return 900;
}

export function nextPlaybackIndex(currentIndex: number, frameCount: number) {
  if (frameCount <= 1) return 0;
  if (currentIndex <= 0) return frameCount - 1;
  return currentIndex - 1;
}

export function previousHistoricalIndex(currentIndex: number, frameCount: number) {
  if (!frameCount) return 0;
  return Math.min(frameCount - 1, currentIndex + 1);
}

export function nextHistoricalIndex(currentIndex: number, frameCount: number) {
  if (!frameCount) return 0;
  return Math.max(0, currentIndex - 1);
}

export function writeRadarLoopDiagnostics(diagnostics: RadarLoopDiagnostics) {
  try {
    window.localStorage.setItem(LOOP_DIAGNOSTICS_KEY, JSON.stringify(diagnostics));
  } catch {
    // Diagnostics must never affect playback.
  }
}

export function readRadarLoopDiagnostics(): RadarLoopDiagnostics | null {
  try {
    const raw = window.localStorage.getItem(LOOP_DIAGNOSTICS_KEY);
    return raw ? JSON.parse(raw) as RadarLoopDiagnostics : null;
  } catch {
    return null;
  }
}
