import type { MissionSession } from "./missionSession";
import {
  getNativeChaseStatus,
  loadNativeChaseStatus,
  startNativeChaseTracking,
  stopNativeChaseTracking,
  subscribeNativeChaseTracking,
  syncNativeChaseBreadcrumbs,
  type NativeChasePoint,
  type NativeChaseStatus,
} from "./nativeChaseTracking";
import type { LocationObservation, TrackingDetailPreset } from "./locationObservation";
import { createLocationObservation } from "./locationObservation";
import { getPlatformCapabilities, platformSupportsPersistentChaseTracking } from "./platformCapabilities";

export type TrackingPermissionState = "granted" | "denied" | "unsupported" | "unknown";
export type LocationTrackingState = "inactive" | "starting" | "active" | "degraded" | "unavailable";

export interface LocationTrackingStatus {
  state: LocationTrackingState;
  active: boolean;
  sessionId: string | null;
  startedAt: number;
  stoppedAt: number;
  pointCount: number;
  latestObservation: LocationObservation | null;
  lastError: string | null;
  lastServiceEvent: string | null;
  platform: string;
  implementation: "native-persistent-location" | "web-geolocation" | "unavailable";
  locationPermission: TrackingPermissionState;
  notificationPermission: TrackingPermissionState;
  backgroundCapable: boolean;
}

export interface LocationTrackingStartOptions {
  session: MissionSession;
  detailPreset: TrackingDetailPreset;
  persistent: boolean;
}

export interface LocationTrackingService {
  start(options: LocationTrackingStartOptions): Promise<LocationTrackingStatus>;
  stop(): Promise<LocationTrackingStatus>;
  getStatus(): LocationTrackingStatus;
  loadStatus(): Promise<LocationTrackingStatus>;
  syncPendingObservations(): Promise<LocationTrackingStatus>;
  subscribe(listener: (status: LocationTrackingStatus) => void): () => void;
}

const listeners = new Set<(status: LocationTrackingStatus) => void>();
let currentStatus = normalizeNativeStatus(getNativeChaseStatus());

function pointToObservation(point: NativeChasePoint | null): LocationObservation | null {
  if (!point) return null;
  return createLocationObservation({
    id: point.id,
    sessionId: point.sessionId ?? null,
    timestampUtc: point.timestamp,
    receivedAt: point.at ?? point.timestamp,
    storedAt: point.at ?? point.timestamp,
    latitude: point.lat,
    longitude: point.lon,
    horizontalAccuracyM: point.accuracyM ?? null,
    altitudeM: point.altitudeM ?? null,
    altitudeAccuracyM: null,
    speedMps: point.speedMph != null ? point.speedMph / 2.2369362921 : null,
    speedMph: point.speedMph ?? null,
    speedAccuracyMps: null,
    headingDeg: point.headingDeg ?? null,
    headingAccuracyDeg: null,
    provider: point.provider ?? null,
    source: point.source ?? "native-persistent-location",
    stale: point.stale ?? false,
  });
}

function normalizeNativeStatus(status: NativeChaseStatus): LocationTrackingStatus {
  const capabilities = getPlatformCapabilities();
  const nativeAndroidStatus = status.platform === "android";
  const backgroundCapable = platformSupportsPersistentChaseTracking(capabilities) || nativeAndroidStatus;
  const latestObservation = pointToObservation(status.lastPoint);
  const active = Boolean(status.active);
  const unavailable = !backgroundCapable && !active;
  const denied = status.locationPermission === "denied";
  const state: LocationTrackingState = unavailable
    ? "unavailable"
    : active
      ? "active"
      : denied || status.lastError
        ? "degraded"
        : "inactive";
  return {
    state,
    active,
    sessionId: status.sessionId,
    startedAt: status.startedAt,
    stoppedAt: status.stoppedAt,
    pointCount: status.pointCount,
    latestObservation,
    lastError: unavailable ? "PERSISTENT_TRACKING_UNSUPPORTED" : status.lastError,
    lastServiceEvent: status.lastServiceEvent,
    platform: status.platform,
    implementation: nativeAndroidStatus ? "native-persistent-location" : unavailable ? "unavailable" : "web-geolocation",
    locationPermission: status.locationPermission,
    notificationPermission: status.notificationPermission,
    backgroundCapable,
  };
}

function publish(status: NativeChaseStatus | LocationTrackingStatus) {
  currentStatus = "latestObservation" in status ? status : normalizeNativeStatus(status);
  listeners.forEach((listener) => listener(currentStatus));
  window.dispatchEvent(new CustomEvent("codeblack:location-tracking", { detail: currentStatus }));
  return currentStatus;
}

subscribeNativeChaseTracking((status) => {
  publish(status);
});

export const locationTrackingService: LocationTrackingService = {
  async start(options) {
    const capabilities = getPlatformCapabilities();
    if (!options.persistent || !platformSupportsPersistentChaseTracking(capabilities)) {
      return publish({ ...currentStatus, state: options.persistent ? "unavailable" : "inactive", active: false, lastError: options.persistent ? "PERSISTENT_TRACKING_UNSUPPORTED" : null });
    }
    return publish(await startNativeChaseTracking(options.session, { detailPreset: options.detailPreset }));
  },
  async stop() {
    return publish(await stopNativeChaseTracking());
  },
  getStatus() {
    return currentStatus;
  },
  async loadStatus() {
    return publish(await loadNativeChaseStatus());
  },
  async syncPendingObservations() {
    return publish(await syncNativeChaseBreadcrumbs());
  },
  subscribe(listener) {
    listeners.add(listener);
    listener(currentStatus);
    return () => {
      listeners.delete(listener);
    };
  },
};
