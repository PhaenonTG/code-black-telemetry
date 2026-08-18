import { useEffect, useState } from "react";
import { locationTrackingService, type LocationTrackingStatus } from "../services/locationTracking";

const INITIAL_STATUS: LocationTrackingStatus = {
  state: "inactive",
  active: false,
  sessionId: null,
  startedAt: 0,
  stoppedAt: 0,
  pointCount: 0,
  latestObservation: null,
  lastError: null,
  lastServiceEvent: null,
  platform: "unknown",
  implementation: "unavailable",
  locationPermission: "unknown",
  notificationPermission: "unknown",
  backgroundCapable: false,
};

export function useLocationTracking() {
  const [status, setStatus] = useState<LocationTrackingStatus>(INITIAL_STATUS);

  useEffect(() => {
    const unsubscribe = locationTrackingService.subscribe(setStatus);
    void locationTrackingService.loadStatus();
    return unsubscribe;
  }, []);

  return status;
}
