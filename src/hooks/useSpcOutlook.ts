import { useEffect, useRef, useState } from "react";
import { getSpcOutlooks, type SpcDayOutlook } from "../services/spcOutlook";
import { useResumeTick } from "./useResumeTick";

type GpsPoint = { lat: number; lon: number };

// SPC reissues day1 a handful of times per day and day2/3 once or twice -- polling every 10
// minutes (matching the service's own cache TTL) is frequent enough to catch a reissue on a
// multi-day chase without hammering SPC on every render.
const POLL_MS = 10 * 60_000;

export function useSpcOutlook(gps: GpsPoint | null) {
  const [outlooks, setOutlooks] = useState<SpcDayOutlook[]>([]);
  const resumeTick = useResumeTick();
  // App.tsx rebuilds its gps object every telemetry tick -- depending on gps directly tore this
  // effect down and restarted its 10-minute interval that often too, refetching SPC on every tick
  // instead of every 10 minutes. gps==null only flips on a real fix acquired/lost, so the effect
  // (and its interval) stays put; load() still reads the live position via this ref so a mid-chase
  // relocation is reflected on the next scheduled poll instead of freezing at launch position.
  const gpsRef = useRef(gps);
  gpsRef.current = gps;

  useEffect(() => {
    if (!gps) return;
    let cancelled = false;
    const load = async () => {
      const currentGps = gpsRef.current;
      if (!currentGps) return;
      const next = await getSpcOutlooks(currentGps);
      if (!cancelled) setOutlooks(next);
    };
    void load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [gps == null, resumeTick]);

  return outlooks;
}
