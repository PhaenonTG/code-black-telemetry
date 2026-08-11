import { distanceMiles } from "./telemetry/quality";

export interface StormReport {
  id: string;
  type: string;
  location: string;
  state: string;
  magnitude: string;
  units: string;
  remarks: string;
  office: string;
  officeId: string;
  validTime: number;
  validTimeText: string;
  lat: number;
  lon: number;
  distanceMiles: number;
}

type Position = { lat: number; lon: number };

type ArcGisFeature = {
  geometry?: {
    coordinates?: unknown;
  };
  properties?: Record<string, unknown>;
};

type ArcGisFeatureCollection = {
  features?: ArcGisFeature[];
};

const LSR_QUERY_URL = "https://mapservices.weather.noaa.gov/vector/rest/services/obs/nws_local_storm_reports/MapServer/0/query";

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function boundingBox(origin: Position, radiusMiles: number) {
  const latDelta = radiusMiles / 69;
  const lonDelta = radiusMiles / Math.max(1, Math.cos((origin.lat * Math.PI) / 180) * 69);
  return {
    xmin: origin.lon - lonDelta,
    ymin: origin.lat - latDelta,
    xmax: origin.lon + lonDelta,
    ymax: origin.lat + latDelta,
    spatialReference: { wkid: 4326 },
  };
}

function parseValidTime(rawDate: unknown, rawText: unknown): number {
  const dateMs = readNumber(rawDate);
  if (dateMs != null) return dateMs;
  const text = readString(rawText);
  const parsed = text ? Date.parse(text) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export function reportAgeText(validTime: number): string {
  const ageMs = Date.now() - validTime;
  if (ageMs < 0) return "NOW";
  const minutes = Math.round(ageMs / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}M AGO`;
  return `${Math.round(minutes / 60)}H AGO`;
}

export async function getNearbyStormReports(
  origin: Position,
  radiusMiles: number,
  retentionHours: number,
): Promise<{ reports: StormReport[]; error: string }> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const params = new URLSearchParams({
      f: "geojson",
      where: "1=1",
      outFields: "objectid,wfo_id,wfo,lsr_validtime,descript,loc_desc,state,magnitude,units,remarks,valid_time",
      geometry: JSON.stringify(boundingBox(origin, radiusMiles)),
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      outSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      orderByFields: "lsr_validtime desc",
      resultRecordCount: "2000",
      returnGeometry: "true",
    });
    const response = await fetch(`${LSR_QUERY_URL}?${params}`, { signal: controller.signal });
    if (!response.ok) return { reports: [], error: `${response.status} ${response.statusText}` };
    const body = (await response.json()) as ArcGisFeatureCollection;
    const cutoff = Date.now() - retentionHours * 60 * 60 * 1000;
    const reports = (body.features ?? [])
      .map((feature): StormReport | null => {
        const coords = feature.geometry?.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) return null;
        const lon = readNumber(coords[0]);
        const lat = readNumber(coords[1]);
        if (lat == null || lon == null) return null;
        const props = feature.properties ?? {};
        const validTime = parseValidTime(props.lsr_validtime, props.valid_time);
        if (validTime < cutoff) return null;
        const reportDistance = distanceMiles(origin, { lat, lon });
        if (reportDistance > radiusMiles) return null;
        const objectId = readString(props.objectid) || String(readNumber(props.objectid) ?? `${lat}-${lon}-${validTime}`);
        return {
          id: objectId,
          type: readString(props.descript) || "Report",
          location: readString(props.loc_desc) || "Unknown location",
          state: readString(props.state),
          magnitude: readString(props.magnitude),
          units: readString(props.units),
          remarks: readString(props.remarks),
          office: readString(props.wfo),
          officeId: readString(props.wfo_id),
          validTime,
          validTimeText: readString(props.valid_time),
          lat,
          lon,
          distanceMiles: reportDistance,
        };
      })
      .filter((report): report is StormReport => report !== null)
      .sort((a, b) => b.validTime - a.validTime || a.distanceMiles - b.distanceMiles);
    return { reports, error: "" };
  } catch (error) {
    return { reports: [], error: error instanceof Error ? error.message : "Local storm report feed failed" };
  } finally {
    window.clearTimeout(timer);
  }
}
