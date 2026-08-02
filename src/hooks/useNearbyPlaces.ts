import { useEffect, useState } from "react";
import { getNearbyPlaces, type NearbyCategory, type NearbyPlace } from "../services/nearby";

type GpsPoint = { lat: number; lon: number };

const REFRESH_MS = 10 * 60_000; // Overpass is a shared public service — poll gently, not like telemetry.

export function useNearbyPlaces(gps: GpsPoint | null) {
  const [places, setPlaces] = useState<Partial<Record<NearbyCategory, NearbyPlace>>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    if (!gps) return;
    let cancelled = false;
    const load = async () => {
      const result = await getNearbyPlaces(gps);
      if (!cancelled) {
        setPlaces(result.places);
        setError(result.error);
      }
    };
    void load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // Re-fetching on every minor GPS jitter would hammer Overpass; only whether a fix exists at
    // all (not its exact value) is in the dependency array, so refreshes come from the interval
    // above, not from every GPS coordinate update.
  }, [gps == null]);

  return { places, error };
}
