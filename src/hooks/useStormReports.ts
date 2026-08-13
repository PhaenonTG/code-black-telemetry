import { useEffect, useRef, useState } from "react";
import { getNearbyStormReports, type StormReport } from "../services/stormReports";
import { useResumeTick } from "./useResumeTick";

type GpsPoint = { lat: number; lon: number };

export function useStormReports(gps: GpsPoint | null, radiusMiles: number, retentionHours: number) {
  const [reports, setReports] = useState<StormReport[]>([]);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const gpsRef = useRef(gps);
  const resumeTick = useResumeTick();
  gpsRef.current = gps;
  const hasGps = gps != null;

  useEffect(() => {
    if (!hasGps) {
      setReports([]);
      setError("");
      setUpdatedAt(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const currentGps = gpsRef.current;
      if (!currentGps) return;
      const result = await getNearbyStormReports(currentGps, radiusMiles, retentionHours);
      if (cancelled) return;
      setReports(result.reports);
      setError(result.error);
      setUpdatedAt(Date.now());
    };
    void load();
    const refreshTimer = window.setInterval(load, 5 * 60_000);
    const pruneTimer = window.setInterval(() => {
      const cutoff = Date.now() - retentionHours * 60 * 60 * 1000;
      setReports((current) => current.filter((report) => report.validTime >= cutoff));
    }, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
      window.clearInterval(pruneTimer);
    };
  }, [hasGps, radiusMiles, retentionHours, resumeTick]);

  return { reports, error, updatedAt };
}
