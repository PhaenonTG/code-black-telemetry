import { useEffect, useState } from "react";
import { getNearbySpotters, type Spotter } from "../services/spotters";

type GpsPoint = { lat: number; lon: number };

// The feed's own "Refresh: 1" directive (in the raw GRLevelX header) implies ~1 min is the
// intended client refresh cadence for this format; 2 min is a slightly more conservative choice
// on top of that for a free, non-commercial public feed.
const REFRESH_MS = 2 * 60_000;

export function useSpotters(gps: GpsPoint | null) {
  const [spotters, setSpotters] = useState<Spotter[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!gps) return;
    let cancelled = false;
    const load = async () => {
      const result = await getNearbySpotters(gps);
      if (!cancelled) {
        setSpotters(result.spotters);
        setError(result.error);
      }
    };
    void load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [gps == null]);

  return { spotters, error };
}
