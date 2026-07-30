import { useEffect, useRef, useState } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { setTabletLocation } from "../services/telemetry";

export type TabletLocationPermission = "unsupported" | "idle" | "active" | "denied" | "error";

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

const TabletLocationNative = registerPlugin<{ getLastKnownLocation: () => Promise<NativePosition> }>("TabletLocationNative");

export function useTabletLocation(shouldUse: boolean) {
  const [permission, setPermission] = useState<TabletLocationPermission>(() => (Capacitor.isNativePlatform() || "geolocation" in navigator ? "idle" : "unsupported"));
  const deniedRef = useRef(false);

  useEffect(() => {
    if (!shouldUse || deniedRef.current) return;
    if (Capacitor.isNativePlatform()) {
      let cancelled = false;
      let watchId: string | null = null;
      const publishPosition = (position: {
        coords: {
          latitude: number;
          longitude: number;
          accuracy: number;
          speed?: number | null;
          heading?: number | null;
          altitude?: number | null;
        };
        timestamp: number;
      }) => {
        setPermission("active");
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
      };
      const startNativeWatch = async () => {
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
              setPermission(error.message.toLowerCase().includes("denied") ? "denied" : "error");
              return;
            }
            if (!position) return;
            publishPosition(position);
          },
        );
      };
      void startNativeWatch();
      return () => {
        cancelled = true;
        if (watchId) void Geolocation.clearWatch({ id: watchId });
      };
    }

    if (!("geolocation" in navigator)) return;
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setPermission("active");
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
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          deniedRef.current = true;
          setPermission("denied");
        } else {
          setPermission("error");
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [shouldUse]);

  return permission;
}
