import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { setTabletLocation } from "../services/telemetry";

export type TabletLocationPermission = "unsupported" | "idle" | "active" | "denied" | "error";

export function useTabletLocation(shouldUse: boolean) {
  const [permission, setPermission] = useState<TabletLocationPermission>(() => (Capacitor.isNativePlatform() || "geolocation" in navigator ? "idle" : "unsupported"));
  const deniedRef = useRef(false);

  useEffect(() => {
    if (!shouldUse || deniedRef.current) return;
    if (Capacitor.isNativePlatform()) {
      let cancelled = false;
      let watchId: string | null = null;
      const startNativeWatch = async () => {
        const permissionStatus = await Geolocation.requestPermissions({ permissions: ["location"] });
        if (permissionStatus.location === "denied") {
          deniedRef.current = true;
          setPermission("denied");
          return;
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
