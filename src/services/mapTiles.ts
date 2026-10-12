const compiledMapboxToken = (import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined)?.trim() ?? "";
const runtimeTokenPath = "/overlay-core/mapbox-token";
let resolvedMapboxToken = compiledMapboxToken;
let runtimeTokenRequest: Promise<boolean> | null = null;

export type BasemapProvider = "mapbox" | "osm";

export function hasMapboxToken() {
  return resolvedMapboxToken.startsWith("pk.") && resolvedMapboxToken.length > 20;
}

export function mapboxAccessToken() {
  return resolvedMapboxToken;
}

/**
 * OPS keeps its public Mapbox token in the Pages runtime rather than baking it
 * into the browser bundle.  The shared map package still supports native/local
 * builds through VITE_MAPBOX_ACCESS_TOKEN, but an OPS refresh must wait for this
 * one small runtime bootstrap before constructing Mapbox GL.
 */
export async function ensureMapboxAccessToken(): Promise<boolean> {
  if (hasMapboxToken()) return true;
  if (typeof window === "undefined" || typeof fetch !== "function") return false;
  if (!runtimeTokenRequest) {
    runtimeTokenRequest = fetch(runtimeTokenPath, { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return false;
        const body = await response.json() as { token?: unknown };
        const token = typeof body.token === "string" ? body.token.trim() : "";
        if (!token.startsWith("pk.") || token.length <= 20) return false;
        resolvedMapboxToken = token;
        return true;
      })
      .catch(() => false);
  }
  return runtimeTokenRequest;
}

export function atlasStyleUri() {
  const style = ((import.meta.env.VITE_ATLAS_MAPBOX_STYLE as string | undefined)?.trim() || "mapbox/navigation-night-v1").replace("mapbox://styles/", "");
  const parts = style.split("/").map((part) => encodeURIComponent(part.trim())).filter(Boolean);
  return `mapbox://styles/${parts.length === 2 ? `${parts[0]}/${parts[1]}` : "mapbox/navigation-night-v1"}`;
}

export function mapboxReverseGeocodeUrl(lat: number, lon: number) {
  if (!hasMapboxToken()) return "";
  const token = encodeURIComponent(resolvedMapboxToken);
  return `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lon.toFixed(6)}&latitude=${lat.toFixed(6)}&types=place,locality,neighborhood,district,region&access_token=${token}`;
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
  mosaicVisible: boolean;
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
