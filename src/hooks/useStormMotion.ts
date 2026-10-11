import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { getRadarStatus, getSavedWebStormMotion, type StormMotion } from "../services/radar";

// 30s poll interval on getRadarStatus (services/radar.ts) -- independent polling rather than a
// shared store, matching this codebase's existing per-page-hook convention (useNearbyStormThreats,
// useSpcOutlook, etc. each own their fetch/interval).
const POLL_MS = 30_000;

export function useStormMotion(): StormMotion | null {
  const [motion, setMotion] = useState<StormMotion | null>(getSavedWebStormMotion);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (!Capacitor.isNativePlatform()) {
        if (!cancelled) setMotion(getSavedWebStormMotion());
        return;
      }
      try {
        const status = await getRadarStatus("AUTO", "REF", 0.5);
        if (!cancelled) setMotion(status.stormMotion);
      } catch {
        // Leave the last-known motion in place rather than blank the readout on a transient
        // failure -- same resilience convention as the Nearby card fix from the Aug 2 redesign.
      }
    };
    void refresh();
    const onLocalMotion = () => setMotion(getSavedWebStormMotion());
    window.addEventListener("codeblack:radar-storm-motion", onLocalMotion);
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      cancelled = true;
      window.removeEventListener("codeblack:radar-storm-motion", onLocalMotion);
      window.clearInterval(timer);
    };
  }, []);

  return motion;
}
