import { useEffect, useRef, useState } from "react";
import { getNearbyPlaces, type NearbyCategory, type NearbyPlace } from "../services/nearby";
import { useResumeTick } from "./useResumeTick";

type GpsPoint = { lat: number; lon: number };

const ALL_CATEGORIES: NearbyCategory[] = ["gas", "hospital", "lodging", "food"];
const REFRESH_MS = 10 * 60_000; // Overpass is a shared public service — poll gently, not like telemetry.
const RETRY_BASE_MS = 30_000; // A failed fetch backs off from here, doubling up to REFRESH_MS —
// a one-off blip (e.g. the brief network hiccup a USB cable swap can cause) recovers in well under
// a minute instead of sitting stuck until the next 10-minute tick.

export function useNearbyPlaces(gps: GpsPoint | null) {
  const [places, setPlaces] = useState<Partial<Record<NearbyCategory, NearbyPlace>>>({});
  const [error, setError] = useState("");
  const resumeTick = useResumeTick();
  const gpsRef = useRef(gps);
  gpsRef.current = gps;
  const hasGps = gps != null;

  useEffect(() => {
    if (!hasGps) return;
    let cancelled = false;
    let timer: number | undefined;
    let retryDelay = RETRY_BASE_MS;

    const load = async () => {
      const currentGps = gpsRef.current;
      if (!currentGps) return;
      const result = await getNearbyPlaces(currentGps);
      if (cancelled) return;
      setError(result.error);
      // Each category is fetched independently now (see nearby.ts) -- a category missing from a
      // result that otherwise succeeded isn't a hard error, but it's still incomplete and worth
      // retrying sooner than the full 10-minute cadence rather than leaving that one card blank
      // for the rest of the interval.
      const incomplete = ALL_CATEGORIES.some((category) => !(category in result.places));
      if (result.error || incomplete) {
        // Places aren't fast-changing (gas stations don't move); keep the last known-good list
        // on screen instead of blanking it out over a single failed/partial refresh.
        setPlaces((current) => ({ ...current, ...result.places }));
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
    // Re-fetching on every minor GPS jitter would hammer Overpass; only whether a fix exists at
    // all (not its exact value) is in the dependency array, so refreshes come from the schedule
    // above, not from every GPS coordinate update.
  }, [hasGps, resumeTick]);

  return { places, error };
}
