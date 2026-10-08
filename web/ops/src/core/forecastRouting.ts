export type ForecastDestination = { latitude: number; longitude: number; valid_time: string };
export type Arrival = { status: "reachable" | "late" | "unknown"; duration_minutes?: number; arrival_time?: string };
const cache = new Map<string, { expires: number; duration: number }>();

export function arrivalStatus(durationSeconds: number, departure: string, validTime: string, marginMinutes: number): Arrival {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0 || !Number.isFinite(Date.parse(departure)) || !Number.isFinite(Date.parse(validTime))) return { status: "unknown" };
  const arrival = Date.parse(departure) + durationSeconds * 1000;
  return { status: arrival + marginMinutes * 60_000 <= Date.parse(validTime) ? "reachable" : "late", duration_minutes: Math.ceil(durationSeconds / 60), arrival_time: new Date(arrival).toISOString() };
}

export async function routeForecastTargets<T extends ForecastDestination>(targets: T[], origin: { latitude: number; longitude: number }, token: string, departure: string, margin: number, signal: AbortSignal): Promise<(T & { arrival: Arrival })[]> {
  const output = targets.slice(0, 10).map((target) => ({ ...target, arrival: { status: "unknown" } as Arrival }));
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, output.length) }, async () => {
    while (cursor < output.length && !signal.aborted) {
      const index = cursor++;
      const target = output[index];
      if (!token.startsWith("pk.")) continue;
      const coordinates = `${origin.longitude},${origin.latitude};${target.longitude},${target.latitude}`;
      const key = `${coordinates}/${departure}`;
      try {
        let duration = cache.get(key)?.expires! > Date.now() ? cache.get(key)?.duration : undefined;
        if (duration === undefined) {
          const params = new URLSearchParams({ access_token: token, overview: "false", steps: "false", depart_at: departure });
          const response = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coordinates}?${params}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) });
          if (!response.ok) continue;
          const body = await response.json() as { code?: string; routes?: { duration?: number }[] };
          duration = body.routes?.[0]?.duration;
          if (body.code !== "Ok" || typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) continue;
          cache.set(key, { expires: Date.now() + 300_000, duration });
          if (cache.size > 100) cache.delete(cache.keys().next().value!);
        }
        target.arrival = arrivalStatus(duration, departure, target.valid_time, margin);
      } catch { /* Unknown is explicit; straight-line distance is never substituted for a route. */ }
    }
  }));
  return output;
}
