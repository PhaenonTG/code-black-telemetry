const MAPBOX_PUBLIC_TOKEN = (import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined)?.trim() ?? "";
const MAPBOX_STYLE = (import.meta.env.VITE_MAPBOX_STYLE as string | undefined)?.trim() || "mapbox/navigation-night-v1";
const MAPBOX_STYLE_PARTS = MAPBOX_STYLE.split("/").map((part) => encodeURIComponent(part.trim())).filter(Boolean);

export type BasemapProvider = "mapbox" | "osm";
export type MapboxTokenPrefix = "pk" | "sk" | "unknown" | "missing";
export type MapEngine = "legacy" | "atlas";

export function hasMapboxToken() {
  return MAPBOX_PUBLIC_TOKEN.startsWith("pk.") && MAPBOX_PUBLIC_TOKEN.length > 20;
}

export function mapboxAccessToken() {
  return MAPBOX_PUBLIC_TOKEN;
}

export function configuredMapEngine(): MapEngine {
  const envEngine = ((import.meta.env.VITE_MAP_ENGINE as string | undefined) || "").trim().toLowerCase();
  const localEngine = (() => {
    try {
      return window.localStorage.getItem("codeblack.map.engine")?.toLowerCase() ?? "";
    } catch {
      return "";
    }
  })();
  const next = localEngine || envEngine || "atlas";
  return next === "atlas" ? "atlas" : "legacy";
}

export function setConfiguredMapEngine(engine: MapEngine) {
  try {
    window.localStorage.setItem("codeblack.map.engine", engine);
    window.dispatchEvent(new CustomEvent("codeblack:map-engine-change", { detail: engine }));
  } catch {
    // The environment flag still controls startup when local storage is unavailable.
  }
}

export function basemapProvider(): BasemapProvider {
  return hasMapboxToken() ? "mapbox" : "osm";
}

export function basemapStatusLabel(provider = basemapProvider()) {
  return provider === "mapbox" ? "MAPBOX BASEMAP" : hasMapboxToken() ? "OSM FALLBACK" : "OSM BASEMAP";
}

export function mapboxStyleId() {
  return MAPBOX_STYLE_PARTS.length === 2 ? `${MAPBOX_STYLE_PARTS[0]}/${MAPBOX_STYLE_PARTS[1]}` : "mapbox/navigation-night-v1";
}

export function atlasStyleUri() {
  const style = ((import.meta.env.VITE_ATLAS_MAPBOX_STYLE as string | undefined)?.trim() || "mapbox/navigation-night-v1").replace("mapbox://styles/", "");
  const parts = style.split("/").map((part) => encodeURIComponent(part.trim())).filter(Boolean);
  return `mapbox://styles/${parts.length === 2 ? `${parts[0]}/${parts[1]}` : "mapbox/navigation-night-v1"}`;
}

export function basemapTileUrl(z: number, x: number, y: number, provider = basemapProvider()) {
  if (provider === "mapbox" && hasMapboxToken()) {
    const style = mapboxStyleId();
    const token = encodeURIComponent(MAPBOX_PUBLIC_TOKEN);
    return `https://api.mapbox.com/styles/v1/${style}/tiles/256/${z}/${x}/${y}?access_token=${token}`;
  }

  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

export function mapboxReverseGeocodeUrl(lat: number, lon: number) {
  if (!hasMapboxToken()) return "";
  const token = encodeURIComponent(MAPBOX_PUBLIC_TOKEN);
  return `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lon.toFixed(6)}&latitude=${lat.toFixed(6)}&types=place,locality,neighborhood,district,region&access_token=${token}`;
}

export function mapboxDiagnostics() {
  const token = MAPBOX_PUBLIC_TOKEN;
  const prefix: MapboxTokenPrefix = token.startsWith("pk.") ? "pk" : token.startsWith("sk.") ? "sk" : token ? "unknown" : "missing";
  const masked = token.length >= 12 ? `${token.slice(0, 8)}...${token.slice(-4)}` : "";
  return {
    tokenPresent: token.length > 0,
    prefix,
    tokenLength: token.length,
    masked,
    style: MAPBOX_STYLE,
    stylePathValid: MAPBOX_STYLE_PARTS.length === 2,
  };
}

export type MapRuntimeDiagnostics = {
  renderer: string;
  styleUri: string;
  styleLoaded: boolean;
  modifiedLayers: number;
  missingTargetLayers: string[];
  zoom: number;
  bearing: number;
  pitch: number;
  cameraMode: string;
  gpsAccuracyM: number | null;
  speedMph: number | null;
  radarOpacity: number;
  product: string;
  provider: BasemapProvider;
  updatedAt: number;
};

const MAP_DIAGNOSTICS_KEY = "codeblack.map.diagnostics";

export function writeMapRuntimeDiagnostics(diagnostics: MapRuntimeDiagnostics) {
  try {
    window.localStorage.setItem(MAP_DIAGNOSTICS_KEY, JSON.stringify(diagnostics));
  } catch {
    // Local diagnostics are best-effort; rendering should never depend on them.
  }
}

export function readMapRuntimeDiagnostics(): MapRuntimeDiagnostics | null {
  try {
    const raw = window.localStorage.getItem(MAP_DIAGNOSTICS_KEY);
    return raw ? JSON.parse(raw) as MapRuntimeDiagnostics : null;
  } catch {
    return null;
  }
}

export async function probeMapboxRuntime() {
  const diagnostics = mapboxDiagnostics();
  if (!hasMapboxToken()) return { ...diagnostics, initResult: "token-unavailable" as const };
  try {
    const response = await fetch(basemapTileUrl(7, 30, 51, "mapbox"), { cache: "no-store" });
    return {
      ...diagnostics,
      initResult: response.ok ? "ok" as const : "http-error" as const,
      statusCategory: `${response.status}`.replace(/\d\d$/, "xx"),
    };
  } catch (error) {
    return {
      ...diagnostics,
      initResult: "network-error" as const,
      statusCategory: error instanceof Error ? error.name : "unknown",
    };
  }
}
