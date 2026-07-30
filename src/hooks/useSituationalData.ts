import { useEffect, useState } from "react";
import { getNearestObservation, type ExternalObservation } from "../services/situational";
import { getReverseLocality, type LocalityResult } from "../services/situational";
import { buildCanonicalLocation, locationRequestKey } from "../services/location";
import { useGps, useStatus, useTelemetry } from "./useTelemetry";
import { useTabletLocation } from "./useTabletLocation";
import { distanceMiles } from "../services/telemetry/quality";

export function useSituationalData() {
  const snapshot = useTelemetry();
  const gps = useGps();
  const status = useStatus();
  const [locality, setLocality] = useState<LocalityResult | null>(null);
  const canonicalLocation = buildCanonicalLocation(gps, locality);
  const tabletPermission = useTabletLocation(Boolean(!gps?.hasFix || gps.source === "simulator" || gps.source === "unavailable" || !status?.piOnline));
  const [external, setExternal] = useState<ExternalObservation | null>(null);
  const lat = canonicalLocation.latitude;
  const lon = canonicalLocation.longitude;

  useEffect(() => {
    if (lat == null || lon == null) return;
    const point = { lat, lon };
    const requestKey = locationRequestKey(point);
    let cancelled = false;
    getReverseLocality(point)
      .then((result) => {
        if (cancelled) return;
        const stillCurrent = canonicalLocation.requestKey === requestKey;
        const belongsToPoint = distanceMiles(point, result) <= 12;
        if (stillCurrent && belongsToPoint) setLocality(result);
      })
      .catch(() => {
        if (!cancelled) setLocality(null);
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lon, canonicalLocation.requestKey]);

  useEffect(() => {
    if (lat == null || lon == null) return;
    const point = { lat, lon };
    let cancelled = false;
    getNearestObservation(point)
      .then((obs) => {
        if (!cancelled) setExternal(obs);
      })
      .catch(() => {
        if (!cancelled) setExternal(null);
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lon]);

  return { snapshot, gps, canonicalLocation, external, tabletPermission };
}
