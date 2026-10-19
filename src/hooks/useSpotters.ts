import { useEffect, useRef, useState } from "react";
import { getAuthenticatedSpotterPositions, getNearbySpotters, type Spotter } from "../services/spotters";
import { getSpotterAccount, subscribeSpotterAccount, type SpotterAccount } from "../services/spotterAccount";
import { useResumeTick } from "./useResumeTick";

type GpsPoint = { lat: number; lon: number };

// The feed's own "Refresh: 1" directive (in the raw GRLevelX header) implies ~1 min is the
// intended client refresh cadence for this format; 2 min is a slightly more conservative choice
// on top of that for a free, non-commercial public feed.
const REFRESH_MS = 2 * 60_000;

// Owner: signed into Spotter Network mid-chase and saw themselves listed as the "closest chaser"
// -- the authenticated positions endpoint (spotters.ts: getAuthenticatedSpotterPositions) returns
// the signed-in account's own broadcast position alongside everyone else's, and that position's
// `id` is the account's own marker (spotters.ts maps `id: p.marker || ...`), matching the marker
// this same account got back from login (spotterAccount.ts). Filtering on that id is precise --
// distance-based "closest is probably me" heuristics would risk hiding a real chaser parked right
// next to you.
function excludeSelf(spotters: Spotter[], account: SpotterAccount | null): Spotter[] {
  if (!account?.marker) return spotters;
  return spotters.filter((spotter) => spotter.id !== account.marker);
}

export function useSpotters(gps: GpsPoint | null) {
  const [spotters, setSpotters] = useState<Spotter[]>([]);
  const [error, setError] = useState("");
  const [account, setAccount] = useState(() => getSpotterAccount());
  const resumeTick = useResumeTick();
  const gpsRef = useRef(gps);
  gpsRef.current = gps;
  const hasGps = gps != null;

  useEffect(() => subscribeSpotterAccount(setAccount), []);

  useEffect(() => {
    if (!hasGps) return;
    let cancelled = false;
    const accountId = account?.id ?? null;
    const load = async () => {
      const currentGps = gpsRef.current;
      if (!currentGps) return;
      // Prefer the official JSON positions endpoint when signed in — richer contact data than the
      // anonymous feed. If it fails for any reason (network blip, revoked id), fall back to the
      // anonymous feed rather than showing nothing; a signed-out user always uses the fallback.
      let result = accountId ? await getAuthenticatedSpotterPositions(accountId, currentGps) : await getNearbySpotters(currentGps);
      if (accountId && result.error) result = await getNearbySpotters(currentGps);
      if (!cancelled) {
        setSpotters(excludeSelf(result.spotters, account));
        setError(result.error);
      }
    };
    void load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [account, hasGps, resumeTick]);

  return { spotters, error };
}
