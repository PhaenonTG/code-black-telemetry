import { useEffect, useState } from "react";
import { getRadarStatus, type StormMotion } from "../services/radar";

// Same 30s poll interval as RadarEndpointPanel's own getRadarStatus call (services/radar.ts) --
// independent polling rather than a shared store, matching this codebase's existing per-page-hook
// convention (useNearbyStormThreats, useSpcOutlook, etc. each own their fetch/interval).
const POLL_MS = 30_000;

export function useStormMotion(): StormMotion | null {
  const [motion, setMotion] = useState<StormMotion | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const status = await getRadarStatus("AUTO", "REF", 0.5);
        if (!cancelled) setMotion(status.stormMotion);
      } catch {
        // Leave the last-known motion in place rather than blank the readout on a transient
        // failure -- same resilience convention as the Nearby card fix from the Aug 2 redesign.
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return motion;
}
