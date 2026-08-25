import { useEffect, useRef, useState } from "react";
import { getNearbyStormThreats, type NearbyThreat } from "../services/situational";
import { getNearestRadarSites } from "../services/radar";
import { useResumeTick } from "./useResumeTick";

type GpsPoint = { lat: number; lon: number };

const REFRESH_MS = 90_000;

// Deliberately separate from useAlertProducts -- that hook drives the severe flash overlay and
// alert sound (point-in-polygon "am I inside a warning"), this one answers "what's nearby, even if
// it hasn't reached me yet" for the at-a-glance Home view. Never wire this into the flash/sound
// trigger path; see the comment on getNearbyStormThreats for why.
export function useNearbyStormThreats(gps: GpsPoint | null) {
  const [threats, setThreats] = useState<NearbyThreat[]>([]);
  const [error, setError] = useState("");
  const resumeTick = useResumeTick();
  const gpsRef = useRef(gps);
  gpsRef.current = gps;
  const hasGps = gps != null;

  useEffect(() => {
    if (!hasGps) return;
    let cancelled = false;
    const load = async () => {
      const current = gpsRef.current;
      if (!current) return;
      try {
        const sites = await getNearestRadarSites(current.lat, current.lon);
        const stateAbbr = sites[0]?.state ?? "";
        const next = await getNearbyStormThreats(current, stateAbbr);
        if (!cancelled) {
          setThreats(next);
          setError("");
        }
      } catch {
        if (!cancelled) setError("Nearby threat lookup failed");
      }
    };
    void load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasGps, resumeTick]);

  return { threats, error };
}
