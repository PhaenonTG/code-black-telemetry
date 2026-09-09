export type RoutePoint = { lat: number; lon: number };

export async function fetchNavigationRoute(origin: RoutePoint, destination: RoutePoint, accessToken: string, signal?: AbortSignal): Promise<RoutePoint[]> {
  if (!accessToken.startsWith("pk.")) return [];
  const coordinates = `${origin.lon},${origin.lat};${destination.lon},${destination.lat}`;
  const params = new URLSearchParams({ geometries: "geojson", overview: "full", steps: "false", access_token: accessToken });
  const response = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coordinates}?${params}`, { signal });
  if (!response.ok) throw new Error(`Mapbox directions ${response.status}`);
  const body = await response.json() as { routes?: Array<{ geometry?: { coordinates?: number[][] } }> };
  return (body.routes?.[0]?.geometry?.coordinates ?? []).flatMap((pair) => Number.isFinite(pair[0]) && Number.isFinite(pair[1]) ? [{ lon: pair[0], lat: pair[1] }] : []);
}
