import { useEffect, useState } from "react";
import { getNearestObservation, type ExternalObservation } from "../services/situational";
import { useGps, useStatus, useTelemetry } from "./useTelemetry";
import { useTabletLocation } from "./useTabletLocation";

export function useSituationalData() {
  const snapshot = useTelemetry();
  const gps = useGps();
  const status = useStatus();
  const tabletPermission = useTabletLocation(Boolean(!gps?.hasFix || gps.source === "simulator" || !status?.piOnline));
  const [external, setExternal] = useState<ExternalObservation | null>(null);

  useEffect(() => {
    if (!gps?.lat || !gps?.lon) return;
    let cancelled = false;
    getNearestObservation({ lat: gps.lat, lon: gps.lon })
      .then((obs) => {
        if (!cancelled) setExternal(obs);
      })
      .catch(() => {
        if (!cancelled) setExternal(null);
      });
    return () => {
      cancelled = true;
    };
  }, [gps]);

  return { snapshot, gps, external, tabletPermission };
}
