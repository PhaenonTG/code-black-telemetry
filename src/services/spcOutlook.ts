import { Preferences } from "@capacitor/preferences";

// SPC's public outlook layers -- confirmed live via direct fetch. Day 3 only ever ships a
// categorical layer (SPC doesn't issue a per-hazard tornado probability that far out), so there's
// no day3 tornado URL to add later; that's a real SPC product-line limit, not a gap in this file.
const OUTLOOK_URLS: Record<string, string> = {
  "1-cat": "https://www.spc.noaa.gov/products/outlook/day1otlk_cat.lyr.geojson",
  "1-torn": "https://www.spc.noaa.gov/products/outlook/day1otlk_torn.lyr.geojson",
  "2-cat": "https://www.spc.noaa.gov/products/outlook/day2otlk_cat.lyr.geojson",
  "2-torn": "https://www.spc.noaa.gov/products/outlook/day2otlk_torn.lyr.geojson",
  "3-cat": "https://www.spc.noaa.gov/products/outlook/day3otlk_cat.lyr.geojson",
};

export interface SpcRiskLevel {
  label: string; // e.g. "MRGL", "SLGT", "10%"
  labelLong: string; // e.g. "Marginal Risk", "10% Tornado"
  color: string; // SPC's own fill hex for this tier -- matches their published maps exactly
  issued: string;
  expires: string;
}

export interface SpcDayOutlook {
  day: 1 | 2 | 3;
  categorical: SpcRiskLevel | null;
  tornado: SpcRiskLevel | null;
}

type Position = { lat: number; lon: number };

interface SpcFeature {
  properties?: Record<string, unknown>;
  geometry?: { type: string; coordinates: unknown } | null;
}

const CACHE_MS = 10 * 60_000; // SPC reissues day1 a handful of times/day, day2/3 once or twice
const cache = new Map<string, { expires: number; value: SpcFeature[] }>();
const LAST_OUTLOOK_KEY = "codeblack.lastSpcOutlook";

async function fetchOutlook(url: string): Promise<SpcFeature[]> {
  const cached = cache.get(url);
  if (cached && cached.expires > Date.now()) return cached.value;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/geo+json, application/json" } });
    if (!response.ok) throw new Error(`${response.status}`);
    const data = (await response.json()) as { features?: SpcFeature[] };
    const features = data.features ?? [];
    cache.set(url, { expires: Date.now() + CACHE_MS, value: features });
    return features;
  } finally {
    window.clearTimeout(timer);
  }
}

function pointInRing(point: Position, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = yi > point.lat !== yj > point.lat && point.lon < ((xj - xi) * (point.lat - yi)) / (yj - yi || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// SPC's own layers only ever use Polygon/MultiPolygon for real risk areas -- the "less than 2%
// everywhere" placeholder feature (DN 0) comes back as an empty GeometryCollection instead, which
// correctly matches no point and is skipped rather than needing special-cased handling.
function pointInFeatureGeometry(point: Position, geometry: SpcFeature["geometry"]): boolean {
  if (!geometry) return false;
  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates as number[][][];
    return pointInRing(point, rings[0]);
  }
  if (geometry.type === "MultiPolygon") {
    const polygons = geometry.coordinates as number[][][][];
    return polygons.some((polygon) => pointInRing(point, polygon[0]));
  }
  return false;
}

// Risk polygons are nested (SLGT is drawn as its own shape, not "MRGL minus SLGT"), so a point
// inside the highest tier is also inside every lower tier's shape. Picking the max DN among all
// matches gives the single highest applicable risk instead of whichever tier's feature happened
// to come first in the response.
function highestRisk(features: SpcFeature[], pos: Position): SpcRiskLevel | null {
  let best: { dn: number; level: SpcRiskLevel } | null = null;
  for (const feature of features) {
    const props = feature.properties ?? {};
    const dn = Number(props.DN ?? 0);
    if (dn <= 0) continue;
    if (!pointInFeatureGeometry(pos, feature.geometry)) continue;
    if (best && dn <= best.dn) continue;
    const label = String(props.LABEL ?? "");
    const labelLong = String(props.LABEL2 ?? label);
    const color = String(props.fill ?? props.stroke ?? "");
    const issued = String(props.ISSUE_ISO ?? props.ISSUE ?? "");
    const expires = String(props.EXPIRE_ISO ?? props.EXPIRE ?? "");
    best = { dn, level: { label, labelLong, color, issued, expires } };
  }
  return best?.level ?? null;
}

export async function getSpcOutlooks(pos: Position): Promise<SpcDayOutlook[]> {
  try {
    const [cat1, torn1, cat2, torn2, cat3] = await Promise.all([
      fetchOutlook(OUTLOOK_URLS["1-cat"]),
      fetchOutlook(OUTLOOK_URLS["1-torn"]),
      fetchOutlook(OUTLOOK_URLS["2-cat"]),
      fetchOutlook(OUTLOOK_URLS["2-torn"]),
      fetchOutlook(OUTLOOK_URLS["3-cat"]),
    ]);
    const outlooks: SpcDayOutlook[] = [
      { day: 1, categorical: highestRisk(cat1, pos), tornado: highestRisk(torn1, pos) },
      { day: 2, categorical: highestRisk(cat2, pos), tornado: highestRisk(torn2, pos) },
      { day: 3, categorical: highestRisk(cat3, pos), tornado: null },
    ];
    await Preferences.set({ key: LAST_OUTLOOK_KEY, value: JSON.stringify(outlooks) });
    return outlooks;
  } catch {
    const saved = await Preferences.get({ key: LAST_OUTLOOK_KEY });
    if (!saved.value) return [];
    try {
      return JSON.parse(saved.value) as SpcDayOutlook[];
    } catch {
      return [];
    }
  }
}
