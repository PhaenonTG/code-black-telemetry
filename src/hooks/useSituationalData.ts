import { useEffect, useMemo, useState } from "react";
import { getNearestObservation, type ExternalObservation } from "../services/situational";
import { getReverseLocality, type LocalityResult } from "../services/situational";
import { buildCanonicalLocation, locationRequestKey } from "../services/location";
import { useGps, useStatus } from "./useTelemetry";
import { useTabletLocation } from "./useTabletLocation";
import { distanceMiles } from "../services/telemetry/quality";

export function useSituationalData() {
  const gps = useGps();
  const status = useStatus();
  const [locality, setLocality] = useState<LocalityResult | null>(null);
  // gps/locality are now stable references when their own values haven't changed (useGps is
  // shallow-compared, setLocality only fires on a real resolved place) -- memoizing here means
  // App.tsx's mapGps/canonicalLocation-derived values stay stable too instead of forcing every
  // page in the swipeable pager to re-render on every telemetry tick even when nothing moved.
  const canonicalLocation = useMemo(() => buildCanonicalLocation(gps, locality), [gps, locality]);
  const tabletPermission = useTabletLocation(Boolean(!gps?.hasFix || gps.source === "simulator" || gps.source === "unavailable" || !status?.piOnline));
  const [external, setExternal] = useState<ExternalObservation | null>(null);
  const lat = canonicalLocation.latitude;
  const lon = canonicalLocation.longitude;

  useEffect(() => {
    if (lat == null || lon == null) {
      setLocality(null);
      return;
    }
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
    if (lat == null || lon == null) {
      setExternal(null);
      return;
    }
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

  return { gps, canonicalLocation, external, tabletPermission };
}
