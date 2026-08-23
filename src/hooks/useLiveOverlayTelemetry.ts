import { useEffect, useState } from "react";
import { liveOverlayTelemetryPublisher, type LiveOverlayTelemetryStatus } from "../services/liveOverlayTelemetry";

const INITIAL_STATUS: LiveOverlayTelemetryStatus = {
  state: "disabled",
  stationId: "CBWX-001",
  endpoint: "",
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastPublishedAt: null,
  failureCount: 0,
  retryAt: null,
  lastErrorCode: null,
  lastErrorSummary: "",
  lastReason: "",
  activeSessionId: null,
};

export function useLiveOverlayTelemetry() {
  const [status, setStatus] = useState<LiveOverlayTelemetryStatus>(INITIAL_STATUS);

  useEffect(() => {
    const unsubscribe = liveOverlayTelemetryPublisher.subscribe(setStatus);
    liveOverlayTelemetryPublisher.start();
    return unsubscribe;
  }, []);

  return status;
}
