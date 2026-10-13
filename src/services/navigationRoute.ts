export type RoutePoint = { lat: number; lon: number };

// Approximate distance from a point to a route polyline, suitable for ranking provider markers.
export function distanceToRouteMiles(point: RoutePoint, route: RoutePoint[]): number {
  let best = Number.POSITIVE_INFINITY;
  const scale = Math.cos(point.lat * Math.PI / 180);
  for (let index = 1; index < route.length; index += 1) {
    const a = route[index - 1]; const b = route[index];
    const ax = (a.lon - point.lon) * 69 * scale; const ay = (a.lat - point.lat) * 69;
    const bx = (b.lon - point.lon) * 69 * scale; const by = (b.lat - point.lat) * 69;
    const dx = bx - ax; const dy = by - ay; const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

export async function fetchNavigationRoute(origin: RoutePoint, destination: RoutePoint, accessToken: string, signal?: AbortSignal): Promise<RoutePoint[]> {
  if (!accessToken.startsWith("pk.")) return [];
  const coordinates = `${origin.lon},${origin.lat};${destination.lon},${destination.lat}`;
  const params = new URLSearchParams({ geometries: "geojson", overview: "full", steps: "false", access_token: accessToken });
  const response = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coordinates}?${params}`, { signal });
  if (!response.ok) throw new Error(`Mapbox directions ${response.status}`);
  const body = await response.json() as { routes?: Array<{ geometry?: { coordinates?: number[][] } }> };
  return (body.routes?.[0]?.geometry?.coordinates ?? []).flatMap((pair) => Number.isFinite(pair[0]) && Number.isFinite(pair[1]) ? [{ lon: pair[0], lat: pair[1] }] : []);
}
