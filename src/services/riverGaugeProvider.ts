import type { MapViewport } from "../map/viewport";

export interface RiverGaugeObservation {
  id: string; name: string; lat: number; lon: number; stageFeet: number; trendFeetPerHour: number | null; observedAt: number; sourceUrl: string;
  floodCategory: "major" | "moderate" | "minor" | "action" | "no_flooding" | "not_defined" | "not_current";
  thresholds: { action: number | null; minor: number | null; moderate: number | null; major: number | null };
}

type UsgsPoint = { value?: string; dateTime?: string };
type UsgsSeries = { sourceInfo?: { siteName?: string; siteCode?: Array<{ value?: string }>; geoLocation?: { geogLocation?: { latitude?: number; longitude?: number } } }; values?: Array<{ value?: UsgsPoint[] }> };

export async function getRiverGaugesForViewport(viewport: MapViewport, signal?: AbortSignal): Promise<RiverGaugeObservation[]> {
  if (viewport.zoom < 5) return [];
  const params = new URLSearchParams({ format: "json", bBox: [viewport.west, viewport.south, viewport.east, viewport.north].join(","), parameterCd: "00065", siteStatus: "active", period: "P1D" });
  const noaaParams = new URLSearchParams({ f: "geojson", where: "1=1", outFields: "gaugelid,status,location,waterbody,obstime,url,action,flood,moderate,major,observed,units", geometry: `${viewport.west},${viewport.south},${viewport.east},${viewport.north}`, geometryType: "esriGeometryEnvelope", inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects", returnGeometry: "true", resultRecordCount: "2000" });
  const [response, noaaResponse] = await Promise.all([
    fetch(`https://waterservices.usgs.gov/nwis/iv/?${params}`, { signal }),
    fetch(`https://mapservices.weather.noaa.gov/eventdriven/rest/services/water/riv_gauges/MapServer/0/query?${noaaParams}`, { signal }),
  ]);
  if (!response.ok) throw new Error(`USGS river gauges ${response.status}`);
  const body = await response.json() as { value?: { timeSeries?: UsgsSeries[] } };
  const noaaBody = noaaResponse.ok ? await noaaResponse.json() as { features?: Array<{ geometry?: { coordinates?: number[] }; properties?: Record<string, unknown> }> } : { features: [] };
  const noaaGauges = noaaBody.features ?? [];
  return (body.value?.timeSeries ?? []).flatMap((series) => {
    const location = series.sourceInfo?.geoLocation?.geogLocation;
    const values = series.values?.[0]?.value ?? [];
    const valid = values.map((point) => ({ value: Number(point.value), at: Date.parse(point.dateTime ?? "") })).filter((point) => Number.isFinite(point.value) && Number.isFinite(point.at)).sort((a, b) => a.at - b.at);
    const latest = valid.at(-1);
    if (!latest || !Number.isFinite(location?.latitude) || !Number.isFinite(location?.longitude) || Date.now() - latest.at > 2 * 60 * 60_000) return [];
    const prior = [...valid].reverse().find((point) => latest.at - point.at >= 45 * 60_000);
    const hours = prior ? (latest.at - prior.at) / 3_600_000 : 0;
    const id = series.sourceInfo?.siteCode?.[0]?.value ?? `${location?.latitude}-${location?.longitude}`;
    const lat = Number(location?.latitude); const lon = Number(location?.longitude);
    const noaa = noaaGauges.find((feature) => Math.abs(Number(feature.geometry?.coordinates?.[1]) - lat) < 0.015 && Math.abs(Number(feature.geometry?.coordinates?.[0]) - lon) < 0.015)?.properties;
    const threshold = (value: unknown) => { const number = Number(value); return Number.isFinite(number) ? number : null; };
    const rawCategory = String(noaa?.status ?? "not_defined");
    const floodCategory = (["major", "moderate", "minor", "action", "no_flooding", "not_defined"] as const).includes(rawCategory as any) ? rawCategory as RiverGaugeObservation["floodCategory"] : "not_current";
    return [{ id: `usgs-${id}`, name: String(noaa?.location ?? series.sourceInfo?.siteName ?? `USGS ${id}`), lat, lon, stageFeet: latest.value, trendFeetPerHour: prior && hours > 0 ? (latest.value - prior.value) / hours : null, observedAt: latest.at, sourceUrl: String(noaa?.url ?? `https://waterdata.usgs.gov/monitoring-location/${id}/`), floodCategory, thresholds: { action: threshold(noaa?.action), minor: threshold(noaa?.flood), moderate: threshold(noaa?.moderate), major: threshold(noaa?.major) } }];
  });
}
