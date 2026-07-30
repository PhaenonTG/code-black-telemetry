import { Capacitor, registerPlugin } from "@capacitor/core";

export type RadarProduct = "REF" | "VEL" | "SRV" | "CC";
export type RadarFreshness = "LIVE" | "DELAYED" | "STALE" | "CACHED" | "OFFLINE" | "INCOMPLETE" | "SITE DOWN";

export interface RadarSite {
  id: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
  distanceMi?: number;
}

export interface StormMotion {
  directionDegrees: number;
  speedKnots: number;
  source: string;
  updatedAt?: string | number;
}

export interface RadarFrame {
  frameId: string;
  site: RadarSite;
  product: RadarProduct;
  sourceLevel: string;
  tilt: number | null;
  availableTilts: number[];
  elevationAngle: number | null;
  time: string;
  ageSeconds: number;
  freshness: RadarFreshness;
  vcp: number | null;
  nyquistVelocity: number | null;
  quality: string;
  processingDurationMs: number;
  legend: { units: string; stops: number[] };
  tileTemplate?: string;
  imageUrl?: string;
  bounds?: { west: number; south: number; east: number; north: number };
}

export interface RadarStatus {
  backendState: string;
  backendVersion: string;
  selectedSite: string;
  siteMode: "AUTO" | "MANUAL";
  availableProducts: RadarProduct[];
  selectedProduct: RadarProduct;
  sourceLevel: string;
  selectedTilt: number | null;
  availableTilts: number[];
  currentFrameId: string | null;
  frameTime: string | null;
  dataAgeSeconds: number | null;
  frameCount: number;
  cacheState: string;
  processingState: string;
  latestError: string;
  stormMotion: StormMotion | null;
  reconnectState: string;
}

interface RadarNativePlugin {
  initialize(): Promise<{ ok: boolean; engine: string; version: string; decoderState: string }>;
  getStatus(): Promise<RadarStatus>;
  getSites(): Promise<{ sites: RadarSite[] }>;
  getNearestSites(options: { lat: number; lon: number }): Promise<{ sites: RadarSite[] }>;
  selectSite(options: { siteId: string }): Promise<RadarStatus>;
  selectProduct(options: { product: RadarProduct }): Promise<RadarStatus>;
  selectTilt(options: { tilt: number }): Promise<RadarStatus>;
  getAvailableTilts(): Promise<{ tilts: number[]; source: string }>;
  getFrames(options: { site: string; product: RadarProduct; tilt?: number | null; limit?: number }): Promise<{ frames: RadarFrame[]; latestError?: string }>;
  setStormMotion(options: { directionDegrees: number; speedKnots: number; source?: string }): Promise<StormMotion>;
  clearCache(): Promise<{ ok: boolean; cacheState: string }>;
  getCacheStatus(): Promise<{ usedBytes: number; limitBytes: number; sites: number; frames: number; oldestFrame: string | null; newestFrame: string | null }>;
  startLiveUpdates(): Promise<RadarStatus>;
  stopLiveUpdates(): Promise<RadarStatus>;
  addListener(eventName: "radarStatusChanged", listenerFunc: (status: RadarStatus) => void): Promise<{ remove: () => Promise<void> }>;
}

const RadarNative = registerPlugin<RadarNativePlugin>("RadarNative");

const fallbackSites: RadarSite[] = [
  { id: "KSRX", name: "Fort Smith", state: "AR", lat: 35.2904, lon: -94.3619 },
  { id: "KINX", name: "Tulsa", state: "OK", lat: 36.1751, lon: -95.5643 },
  { id: "KTLX", name: "Oklahoma City", state: "OK", lat: 35.3331, lon: -97.2778 },
  { id: "KSGF", name: "Springfield", state: "MO", lat: 37.2352, lon: -93.4006 },
  { id: "KLZK", name: "Little Rock", state: "AR", lat: 34.8365, lon: -92.2622 },
];

let initialized = false;
let lastStatus: RadarStatus | null = null;

async function ensureInitialized() {
  if (initialized) return;
  initialized = true;
  if (Capacitor.isNativePlatform()) {
    try {
      await RadarNative.initialize();
    } catch {
      initialized = false;
    }
  }
}

function distanceMiles(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

function offlineStatus(site = "AUTO", product: RadarProduct = "REF", message = "ON-DEVICE RADAR DECODER NOT INSTALLED"): RadarStatus {
  return {
    backendState: "ON_DEVICE",
    backendVersion: "0.1.0-web-fallback",
    selectedSite: site,
    siteMode: site === "AUTO" ? "AUTO" : "MANUAL",
    availableProducts: ["REF", "VEL", "SRV", "CC"],
    selectedProduct: product,
    sourceLevel: "LEVEL II",
    selectedTilt: 0.5,
    availableTilts: [0.5],
    currentFrameId: null,
    frameTime: null,
    dataAgeSeconds: null,
    frameCount: 0,
    cacheState: "EMPTY",
    processingState: "DECODER_NOT_INSTALLED",
    latestError: message,
    stormMotion: { directionDegrees: 245, speedKnots: 32, source: "MANUAL" },
    reconnectState: "NO_REMOTE_SERVER_REQUIRED",
  };
}

export function onRadarEndpointChange(listener: (endpoint: string) => void) {
  listener("ON_DEVICE");
  return () => undefined;
}

export async function radarBase() {
  return "ON_DEVICE";
}

export function resetRadarEndpointLoad() {
  initialized = false;
}

export function radarTileUrl(frameId: string, z: number, x: number, y: number) {
  const frame = lastFrameById.get(frameId);
  if (frame?.tileTemplate) return frame.tileTemplate.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
  return "";
}

const lastFrameById = new Map<string, RadarFrame>();

function atlasFixtureEnabled() {
  return ((import.meta.env.VITE_ATLAS_RADAR_FIXTURE as string | undefined) ?? "").trim() === "1";
}

function fixtureFrame(siteId: string, product: RadarProduct): RadarFrame {
  const site = fallbackSites.find((item) => item.id === siteId) ?? fallbackSites[0];
  const time = new Date(Date.now() - 4 * 60 * 1000).toISOString();
  return {
    frameId: `atlas-fixture-${site.id}-${product}`,
    site,
    product,
    sourceLevel: "QA FIXTURE",
    tilt: 0.5,
    availableTilts: [0.5],
    elevationAngle: 0.5,
    time,
    ageSeconds: 240,
    freshness: "CACHED",
    vcp: null,
    nyquistVelocity: product === "REF" || product === "CC" ? null : 32,
    quality: "DEBUG_ONLY_FIXTURE",
    processingDurationMs: 0,
    legend: product === "CC" ? { units: "CC", stops: [0.5, 0.7, 0.8, 0.9, 1] } : product === "REF" ? { units: "dBZ", stops: [-10, 20, 35, 50, 65, 80] } : { units: "kt", stops: [-80, -40, 0, 40, 80] },
    imageUrl: "/atlas-fixture-ref.svg",
    bounds: { west: site.lon - 1.8, south: site.lat - 1.45, east: site.lon + 1.8, north: site.lat + 1.45 },
  };
}

export async function getRadarStatus(site: string, product: RadarProduct, tilt?: number | null) {
  await ensureInitialized();
  if (atlasFixtureEnabled()) {
    const frame = fixtureFrame(site === "AUTO" ? "KSRX" : site, product);
    return {
      ...offlineStatus(site, product, ""),
      backendState: "QA_FIXTURE",
      backendVersion: "atlas-recovery-fixture",
      selectedSite: frame.site.id,
      sourceLevel: "QA FIXTURE",
      selectedTilt: frame.elevationAngle,
      availableTilts: frame.availableTilts,
      currentFrameId: frame.frameId,
      frameTime: frame.time,
      dataAgeSeconds: frame.ageSeconds,
      frameCount: 1,
      cacheState: "QA_FIXTURE",
      processingState: "READY",
      latestError: "",
    };
  }
  if (!Capacitor.isNativePlatform()) {
    lastStatus = offlineStatus(site, product);
    return lastStatus;
  }
  try {
    await RadarNative.selectSite({ siteId: site });
    await RadarNative.selectProduct({ product });
    if (tilt != null) await RadarNative.selectTilt({ tilt });
    lastStatus = await RadarNative.getStatus();
    return lastStatus;
  } catch (error) {
    lastStatus = offlineStatus(site, product, error instanceof Error ? error.message : "ON-DEVICE RADAR UNAVAILABLE");
    return lastStatus;
  }
}

export async function getRadarFrames(site: string, product: RadarProduct, tilt?: number | null, limit = 6) {
  await ensureInitialized();
  if (atlasFixtureEnabled()) {
    const frame = fixtureFrame(site === "AUTO" ? "KSRX" : site, product);
    lastFrameById.set(frame.frameId, frame);
    return [frame];
  }
  if (!Capacitor.isNativePlatform()) return [];
  try {
    const result = await RadarNative.getFrames({ site, product, tilt, limit });
    result.frames.forEach((frame) => {
      if (frame.imageUrl) frame.imageUrl = Capacitor.convertFileSrc(frame.imageUrl);
    });
    result.frames.forEach((frame) => lastFrameById.set(frame.frameId, frame));
    return result.frames;
  } catch {
    return [];
  }
}

export async function getNearestRadarSites(lat: number, lon: number) {
  await ensureInitialized();
  if (Capacitor.isNativePlatform()) {
    try {
      const result = await RadarNative.getNearestSites({ lat, lon });
      return result.sites;
    } catch {
      // Use bundled web fallback below.
    }
  }
  return fallbackSites
    .map((site) => ({ ...site, distanceMi: distanceMiles({ lat, lon }, site) }))
    .sort((a, b) => (a.distanceMi ?? 0) - (b.distanceMi ?? 0));
}

export async function setRadarStormMotion(motion: { directionDegrees: number; speedKnots: number; source?: string }) {
  await ensureInitialized();
  if (!Capacitor.isNativePlatform()) return { ...motion, source: motion.source ?? "MANUAL", updatedAt: Date.now() };
  return RadarNative.setStormMotion(motion);
}

export async function getRadarCacheStatus() {
  await ensureInitialized();
  if (!Capacitor.isNativePlatform()) return { usedBytes: 0, limitBytes: 750 * 1024 * 1024, sites: 0, frames: 0, oldestFrame: null, newestFrame: null };
  return RadarNative.getCacheStatus();
}

export async function clearRadarCache() {
  await ensureInitialized();
  if (!Capacitor.isNativePlatform()) return { ok: true, cacheState: "EMPTY" };
  return RadarNative.clearCache();
}

export async function testRadarEndpoint() {
  await ensureInitialized();
  return { ok: Capacitor.isNativePlatform(), status: Capacitor.isNativePlatform() ? 200 : 0, base: "ON_DEVICE" };
}

export function ageText(seconds: number | null | undefined) {
  if (seconds == null) return "--";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}:${String(secs).padStart(2, "0")}`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
