import { distanceMiles } from "./telemetry/quality";

export interface StormReport {
  id: string;
  source: "NWS" | "Spotter Network";
  type: string;
  location: string;
  state: string;
  magnitude: string;
  units: string;
  remarks: string;
  reporter: string;
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
const SPOTTER_NETWORK_REPORTS_URL = "https://www.spotternetwork.org/feeds/reports.txt";

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

function decodeSpotterText(value: string) {
  return value.replace(/\\n/g, "\n").replace(/\\"/g, "\"").trim();
}

function parseSpotterReportBody(body: string) {
  const lines = decodeSpotterText(body).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const reporter = lines.find((line) => line.toLowerCase().startsWith("reported by:"))?.replace(/^reported by:\s*/i, "").trim() ?? "";
  const time = lines.find((line) => line.toLowerCase().startsWith("time:"))?.replace(/^time:\s*/i, "").trim() ?? "";
  const notes = lines.find((line) => line.toLowerCase().startsWith("notes:"))?.replace(/^notes:\s*/i, "").trim() ?? "";
  const detailLines = lines.filter((line) => !/^reported by:|^time:|^notes:/i.test(line));
  const type = detailLines[0] ?? "Spotter Report";
  const size = lines.find((line) => line.toLowerCase().startsWith("size:"))?.replace(/^size:\s*/i, "").trim() ?? "";
  const magnitude = size || (detailLines.slice(1).find((line) => /\b(mph|kts?|in|cm|measured|estimated)\b/i.test(line)) ?? "");
  return { reporter, time, notes, type, magnitude };
}

async function getSpotterNetworkReports(origin: Position, radiusMiles: number, retentionHours: number, signal: AbortSignal): Promise<StormReport[]> {
  const response = await fetch(SPOTTER_NETWORK_REPORTS_URL, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Spotter Network ${response.status} ${response.statusText}`);
  const text = await response.text();
  const cutoff = Date.now() - retentionHours * 60 * 60 * 1000;
  const reports: StormReport[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^Icon:\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),[^"]*"([\s\S]*)"$/);
    if (!match) continue;
    const lat = Number(match[1]);
    const lon = Number(match[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const parsed = parseSpotterReportBody(match[3]);
    const validTime = Date.parse(parsed.time.replace(" UTC", "Z"));
    if (!Number.isFinite(validTime) || validTime < cutoff) continue;
    const reportDistance = distanceMiles(origin, { lat, lon });
    if (reportDistance > radiusMiles) continue;
    reports.push({
      id: `sn-${lat}-${lon}-${validTime}`,
      source: "Spotter Network",
      type: parsed.type,
      location: parsed.reporter ? `Reported by ${parsed.reporter}` : "Spotter Network report",
      state: "",
      magnitude: parsed.magnitude,
      units: "",
      remarks: parsed.notes,
      reporter: parsed.reporter,
      office: "Spotter Network",
      officeId: "SN",
      validTime,
      validTimeText: parsed.time,
      lat,
      lon,
      distanceMiles: reportDistance,
    });
  }
  return reports;
}

async function getNwsLocalStormReports(
  origin: Position,
  radiusMiles: number,
  retentionHours: number,
  signal: AbortSignal,
): Promise<StormReport[]> {
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
    const response = await fetch(`${LSR_QUERY_URL}?${params}`, { signal });
    if (!response.ok) throw new Error(`NWS ${response.status} ${response.statusText}`);
    const body = (await response.json()) as ArcGisFeatureCollection;
    const cutoff = Date.now() - retentionHours * 60 * 60 * 1000;
    return (body.features ?? [])
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
          id: `nws-${objectId}`,
          source: "NWS",
          type: readString(props.descript) || "Report",
          location: readString(props.loc_desc) || "Unknown location",
          state: readString(props.state),
          magnitude: readString(props.magnitude),
          units: readString(props.units),
          remarks: readString(props.remarks),
          reporter: "",
          office: readString(props.wfo),
          officeId: readString(props.wfo_id),
          validTime,
          validTimeText: readString(props.valid_time),
          lat,
          lon,
          distanceMiles: reportDistance,
        };
      })
      .filter((report): report is StormReport => report !== null);
}

export async function getNearbyStormReports(
  origin: Position,
  radiusMiles: number,
  retentionHours: number,
): Promise<{ reports: StormReport[]; error: string }> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const results = await Promise.allSettled([
      getNwsLocalStormReports(origin, radiusMiles, retentionHours, controller.signal),
      getSpotterNetworkReports(origin, radiusMiles, retentionHours, controller.signal),
    ]);
    const reports = results
      .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
      .sort((a, b) => b.validTime - a.validTime || a.distanceMiles - b.distanceMiles);
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason instanceof Error ? result.reason.message : "Report feed failed");
    return { reports, error: reports.length > 0 ? "" : errors.join(" | ") };
  } catch (error) {
    return { reports: [], error: error instanceof Error ? error.message : "Local storm report feed failed" };
  } finally {
    window.clearTimeout(timer);
  }
}
