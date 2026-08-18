import { useEffect, useRef, useState } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { setTabletLocation } from "../services/telemetry";

export type TabletLocationPermission = "unsupported" | "idle" | "searching" | "active" | "denied" | "error";

type NativePosition = {
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number;
    speed?: number | null;
    heading?: number | null;
    altitude?: number | null;
  };
  timestamp: number;
  provider?: string;
};

type PublishablePosition = {
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number;
    speed?: number | null;
    heading?: number | null;
    altitude?: number | null;
  };
  timestamp: number;
};

const TabletLocationNative = registerPlugin<{ getLastKnownLocation: () => Promise<NativePosition> }>("TabletLocationNative");

function supportsBrowserGeolocation() {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

function isBrowserLocationAllowedContext() {
  if (typeof window === "undefined") return false;
  return window.isSecureContext || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

function publishTabletPosition(position: PublishablePosition) {
  const coords = position.coords;
  setTabletLocation({
    lat: coords.latitude,
    lon: coords.longitude,
    accuracyM: coords.accuracy,
    speedMph: typeof coords.speed === "number" && Number.isFinite(coords.speed) ? coords.speed * 2.23694 : null,
    headingDeg: typeof coords.heading === "number" && Number.isFinite(coords.heading) ? coords.heading : null,
    elevationFt: typeof coords.altitude === "number" && Number.isFinite(coords.altitude) ? coords.altitude * 3.28084 : null,
    updatedAt: position.timestamp,
  });
}

export function useTabletLocation(shouldUse: boolean) {
  const [permission, setPermission] = useState<TabletLocationPermission>(() => (Capacitor.isNativePlatform() || supportsBrowserGeolocation() ? "idle" : "unsupported"));
  const deniedRef = useRef(false);
  const lastFixAtRef = useRef(0);

  useEffect(() => {
    if (!shouldUse || deniedRef.current) return;

    const publishPosition = (position: PublishablePosition) => {
      lastFixAtRef.current = Date.now();
      setPermission("active");
      publishTabletPosition(position);
    };

    if (Capacitor.isNativePlatform()) {
      let cancelled = false;
      let watchId: string | null = null;

      const startNativeWatch = async () => {
        setPermission("searching");
        const permissionStatus = await Geolocation.requestPermissions({ permissions: ["location"] });
        if (permissionStatus.location === "denied") {
          deniedRef.current = true;
          setPermission("denied");
          return;
        }
        try {
          const lastKnown = await TabletLocationNative.getLastKnownLocation();
          if (!cancelled) publishPosition(lastKnown);
        } catch {
          // A missing last-known fix is acceptable; the active watch remains authoritative.
        }
        try {
          const current = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, maximumAge: 7 * 24 * 60 * 60 * 1000, timeout: 10_000 });
          if (!cancelled) publishPosition(current);
        } catch {
          // Keep the watch active; some Android providers only produce async updates.
        }
        watchId = await Geolocation.watchPosition(
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 10_000 },
          (position, error) => {
            if (cancelled) return;
            if (error) {
              const denied = error.message.toLowerCase().includes("denied");
              if (denied) deniedRef.current = true;
              setPermission(denied ? "denied" : lastFixAtRef.current > 0 ? "active" : "error");
              return;
            }
            if (position) publishPosition(position);
          },
        );
      };

      void startNativeWatch();
      return () => {
        cancelled = true;
        if (watchId) void Geolocation.clearWatch({ id: watchId });
      };
    }

    if (!supportsBrowserGeolocation() || !isBrowserLocationAllowedContext()) {
      setPermission("unsupported");
      return;
    }

    let cancelled = false;
    let watchId: number | null = null;

    const handleError = (error: GeolocationPositionError) => {
      if (cancelled) return;
      if (error.code === error.PERMISSION_DENIED) {
        deniedRef.current = true;
        setPermission("denied");
        return;
      }
      setPermission(lastFixAtRef.current > 0 ? "active" : error.code === error.TIMEOUT ? "searching" : "error");
    };
    const requestCurrentPosition = () => {
      navigator.geolocation.getCurrentPosition(publishPosition, handleError, { enableHighAccuracy: true, maximumAge: 60_000, timeout: 15_000 });
    };
    const startWatch = () => {
      if (watchId != null) return;
      setPermission("searching");
      requestCurrentPosition();
      watchId = navigator.geolocation.watchPosition(publishPosition, handleError, { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !deniedRef.current) requestCurrentPosition();
    };

    void (async () => {
      try {
        const status = await navigator.permissions?.query?.({ name: "geolocation" as PermissionName });
        if (cancelled) return;
        if (status?.state === "denied") {
          deniedRef.current = true;
          setPermission("denied");
          return;
        }
        if (status) {
          status.onchange = () => {
            if (status.state === "denied") {
              deniedRef.current = true;
              setPermission("denied");
            } else if (!cancelled) {
              startWatch();
            }
          };
        }
      } catch {
        // Some browsers do not expose geolocation permission preflight; watchPosition still reports it.
      }
      if (!cancelled) startWatch();
    })();

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
    };
  }, [shouldUse]);

  return permission;
}
