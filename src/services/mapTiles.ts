const MAPBOX_PUBLIC_TOKEN = (import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined)?.trim() ?? "";

export type BasemapProvider = "mapbox" | "osm";

export function hasMapboxToken() {
  return MAPBOX_PUBLIC_TOKEN.startsWith("pk.") && MAPBOX_PUBLIC_TOKEN.length > 20;
}

export function mapboxAccessToken() {
  return MAPBOX_PUBLIC_TOKEN;
}

export function atlasStyleUri() {
  const style = ((import.meta.env.VITE_ATLAS_MAPBOX_STYLE as string | undefined)?.trim() || "mapbox/navigation-night-v1").replace("mapbox://styles/", "");
  const parts = style.split("/").map((part) => encodeURIComponent(part.trim())).filter(Boolean);
  return `mapbox://styles/${parts.length === 2 ? `${parts[0]}/${parts[1]}` : "mapbox/navigation-night-v1"}`;
}

export function mapboxReverseGeocodeUrl(lat: number, lon: number) {
  if (!hasMapboxToken()) return "";
  const token = encodeURIComponent(MAPBOX_PUBLIC_TOKEN);
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
