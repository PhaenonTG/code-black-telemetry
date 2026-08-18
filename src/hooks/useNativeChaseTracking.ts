import { useEffect, useState } from "react";
import { loadNativeChaseStatus, subscribeNativeChaseTracking, type NativeChaseStatus } from "../services/nativeChaseTracking";

export function useNativeChaseTracking(): NativeChaseStatus {
  const [status, setStatus] = useState<NativeChaseStatus>(() => ({
    active: false,
    sessionId: null,
    startedAt: 0,
    stoppedAt: 0,
    pointCount: 0,
    lastPoint: null,
    lastError: null,
    lastServiceEvent: null,
    platform: "unknown",
    locationPermission: "unknown",
    notificationPermission: "unknown",
  }));

  useEffect(() => {
    const unsubscribe = subscribeNativeChaseTracking(setStatus);
    void loadNativeChaseStatus();
    return unsubscribe;
  }, []);

  return status;
}
