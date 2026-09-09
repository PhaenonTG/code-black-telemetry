import type { MapViewport } from "../map/viewport";

export interface RiverGaugeObservation {
  id: string; name: string; lat: number; lon: number; stageFeet: number; trendFeetPerHour: number | null; observedAt: number; sourceUrl: string;
}

type UsgsPoint = { value?: string; dateTime?: string };
type UsgsSeries = { sourceInfo?: { siteName?: string; siteCode?: Array<{ value?: string }>; geoLocation?: { geogLocation?: { latitude?: number; longitude?: number } } }; values?: Array<{ value?: UsgsPoint[] }> };

export async function getRiverGaugesForViewport(viewport: MapViewport, signal?: AbortSignal): Promise<RiverGaugeObservation[]> {
  if (viewport.zoom < 5) return [];
  const params = new URLSearchParams({ format: "json", bBox: [viewport.west, viewport.south, viewport.east, viewport.north].join(","), parameterCd: "00065", siteStatus: "active", period: "P1D" });
  const response = await fetch(`https://waterservices.usgs.gov/nwis/iv/?${params}`, { signal });
  if (!response.ok) throw new Error(`USGS river gauges ${response.status}`);
  const body = await response.json() as { value?: { timeSeries?: UsgsSeries[] } };
  return (body.value?.timeSeries ?? []).flatMap((series) => {
    const location = series.sourceInfo?.geoLocation?.geogLocation;
    const values = series.values?.[0]?.value ?? [];
    const valid = values.map((point) => ({ value: Number(point.value), at: Date.parse(point.dateTime ?? "") })).filter((point) => Number.isFinite(point.value) && Number.isFinite(point.at)).sort((a, b) => a.at - b.at);
    const latest = valid.at(-1);
    if (!latest || !Number.isFinite(location?.latitude) || !Number.isFinite(location?.longitude) || Date.now() - latest.at > 2 * 60 * 60_000) return [];
    const prior = [...valid].reverse().find((point) => latest.at - point.at >= 45 * 60_000);
    const hours = prior ? (latest.at - prior.at) / 3_600_000 : 0;
    const id = series.sourceInfo?.siteCode?.[0]?.value ?? `${location?.latitude}-${location?.longitude}`;
    return [{ id: `usgs-${id}`, name: series.sourceInfo?.siteName ?? `USGS ${id}`, lat: Number(location?.latitude), lon: Number(location?.longitude), stageFeet: latest.value, trendFeetPerHour: prior && hours > 0 ? (latest.value - prior.value) / hours : null, observedAt: latest.at, sourceUrl: `https://waterdata.usgs.gov/monitoring-location/${id}/` }];
  });
}
