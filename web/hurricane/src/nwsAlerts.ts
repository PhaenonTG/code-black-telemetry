export type NwsAlert = {
  id: string;
  geometry: { type: string; coordinates: unknown } | null;
  properties: { event?: string; headline?: string; severity?: string; expires?: string; web?: string };
};

export type RegionalWarnings = { features: NwsAlert[]; total: number; checkedAt: number };
let cache: { expires: number; promise: Promise<RegionalWarnings> } | null = null;

export function activeWarnings(): Promise<RegionalWarnings> {
  if (cache && cache.expires > Date.now()) return cache.promise;
  const promise = Promise.all(["AL", "MS", "LA", "FL", "GM"].map(async (area) => {
    const response = await fetch(`https://api.weather.gov/alerts/active?area=${area}`, { headers: { Accept: "application/geo+json" }, cache: "no-store" });
    if (!response.ok) throw new Error(`NWS ${area} alerts unavailable`);
    return (await response.json() as { features?: NwsAlert[] }).features ?? [];
  })).then((responses) => {
    const unique = new Map<string, NwsAlert>();
    for (const feature of responses.flat()) if (/\b(watch|warning)\b/i.test(feature.properties?.event ?? "")) unique.set(feature.id, feature);
    const alerts = [...unique.values()];
    return { features: alerts.filter((alert) => alert.geometry), total: alerts.length, checkedAt: Date.now() };
  }).catch((error: unknown) => { cache = null; throw error; });
  cache = { expires: Date.now() + 60_000, promise };
  return promise;
}
