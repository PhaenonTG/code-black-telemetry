import { useEffect, useState } from "react";
import { getAuthenticatedSpotterPositions, getNearbySpotters, type Spotter } from "../services/spotters";
import { getSpotterAccount, subscribeSpotterAccount } from "../services/spotterAccount";

type GpsPoint = { lat: number; lon: number };

// The feed's own "Refresh: 1" directive (in the raw GRLevelX header) implies ~1 min is the
// intended client refresh cadence for this format; 2 min is a slightly more conservative choice
// on top of that for a free, non-commercial public feed.
const REFRESH_MS = 2 * 60_000;

export function useSpotters(gps: GpsPoint | null) {
  const [spotters, setSpotters] = useState<Spotter[]>([]);
  const [error, setError] = useState("");
  const [accountId, setAccountId] = useState(() => getSpotterAccount()?.id ?? null);

  useEffect(() => subscribeSpotterAccount((account) => setAccountId(account?.id ?? null)), []);

  useEffect(() => {
    if (!gps) return;
    let cancelled = false;
    const load = async () => {
      // Prefer the official JSON positions endpoint when signed in — richer contact data than the
      // anonymous feed. If it fails for any reason (network blip, revoked id), fall back to the
      // anonymous feed rather than showing nothing; a signed-out user always uses the fallback.
      let result = accountId ? await getAuthenticatedSpotterPositions(accountId, gps) : await getNearbySpotters(gps);
      if (accountId && result.error) result = await getNearbySpotters(gps);
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
  }, [accountId, gps == null]);

  return { spotters, error };
}
