import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (!gps) return;
    let cancelled = false;
    const load = async () => {
      const next = await getSpcOutlooks(gps);
      if (!cancelled) setOutlooks(next);
    };
    void load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [gps, resumeTick]);

  return outlooks;
}
