import { useEffect, useState } from "react";
import { getNearbyPoiList, type NearbyPlace } from "../services/nearby";
import { useResumeTick } from "./useResumeTick";

type GpsPoint = { lat: number; lon: number };

const REFRESH_MS = 10 * 60_000; // Same cadence as useNearbyPlaces.ts -- gas stations don't move,
// and this hits the same shared public Overpass instance, so there's no reason to poll it any
// harder for the map layer than the Nearby card already does.
const RETRY_BASE_MS = 30_000;

export function useNearbyPoiList(gps: GpsPoint | null) {
  const [places, setPlaces] = useState<NearbyPlace[]>([]);
  const [error, setError] = useState("");
  const resumeTick = useResumeTick();

  useEffect(() => {
    if (!gps) return;
    let cancelled = false;
    let timer: number | undefined;
    let retryDelay = RETRY_BASE_MS;

    const load = async () => {
      const result = await getNearbyPoiList(gps);
      if (cancelled) return;
      setError(result.error);
      if (result.error) {
        // Places aren't fast-changing -- keep the last known-good list on screen instead of
        // blanking the map layer out over a single failed refresh.
        timer = window.setTimeout(load, retryDelay);
        retryDelay = Math.min(retryDelay * 2, REFRESH_MS);
      } else {
        setPlaces(result.places);
        retryDelay = RETRY_BASE_MS;
        timer = window.setTimeout(load, REFRESH_MS);
      }
    };

    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [gps == null, resumeTick]);

  return { places, error };
}
