import { Capacitor, registerPlugin } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import type { MissionSession } from "./missionSession";
import { mergeBreadcrumbPoints, type BreadcrumbPoint } from "./breadcrumbTrail";
import type { TrackingDetailPreset } from "./locationObservation";

export type NativeChasePermissionState = "granted" | "denied" | "unsupported" | "unknown";

export interface NativeChaseStatus {
  active: boolean;
  sessionId: string | null;
  startedAt: number;
  stoppedAt: number;
  pointCount: number;
  lastPoint: NativeChasePoint | null;
  lastError: string | null;
  lastServiceEvent: string | null;
  platform: string;
  locationPermission: NativeChasePermissionState;
  notificationPermission: NativeChasePermissionState;
}

export interface NativeChasePoint {
  id: string;
  lat: number;
  lon: number;
  timestamp: number;
  at: number;
  speedMph: number | null;
  headingDeg: number | null;
  sessionId: string | null;
  accuracyM?: number | null;
  altitudeM?: number | null;
  provider?: string | null;
  source?: string | null;
  valid?: boolean;
  stale?: boolean;
  headingAvailable?: boolean;
  speedAvailable?: boolean;
}

interface ChaseTrackingNativePlugin {
  start(options: { sessionId: string; startedAt: number; trackingPreset?: TrackingDetailPreset }): Promise<NativeChaseStatus>;
  stop(): Promise<NativeChaseStatus>;
  getStatus(): Promise<NativeChaseStatus>;
  getBreadcrumbs(): Promise<NativeChaseStatus & { points?: NativeChasePoint[] }>;
  requestNotificationPermission(): Promise<NativeChaseStatus>;
}

const ChaseTrackingNative = registerPlugin<ChaseTrackingNativePlugin>("ChaseTrackingNative");
const listeners = new Set<(status: NativeChaseStatus) => void>();

let currentStatus: NativeChaseStatus = unavailableStatus();

function unavailableStatus(): NativeChaseStatus {
  return {
    active: false,
    sessionId: null,
    startedAt: 0,
    stoppedAt: 0,
    pointCount: 0,
    lastPoint: null,
    lastError: Capacitor.getPlatform() === "android" && Capacitor.isNativePlatform() ? null : "NATIVE_TRACKING_UNSUPPORTED",
    lastServiceEvent: null,
    platform: Capacitor.getPlatform(),
    locationPermission: Capacitor.getPlatform() === "android" && Capacitor.isNativePlatform() ? "unknown" : "unsupported",
    notificationPermission: Capacitor.getPlatform() === "android" && Capacitor.isNativePlatform() ? "unknown" : "unsupported",
  };
}

function isAndroidNative() {
  return Capacitor.getPlatform() === "android" && Capacitor.isNativePlatform();
}

function normalizeStatus(status: Partial<NativeChaseStatus>): NativeChaseStatus {
  return {
    ...unavailableStatus(),
    ...status,
    active: Boolean(status.active),
    sessionId: status.sessionId ?? null,
    startedAt: Number(status.startedAt ?? 0),
    stoppedAt: Number(status.stoppedAt ?? 0),
    pointCount: Number(status.pointCount ?? 0),
    lastPoint: status.lastPoint ?? null,
    lastError: status.lastError ?? null,
    lastServiceEvent: status.lastServiceEvent ?? null,
    platform: status.platform ?? Capacitor.getPlatform(),
  };
}

function publish(status: Partial<NativeChaseStatus>) {
  currentStatus = normalizeStatus(status);
  listeners.forEach((listener) => listener(currentStatus));
  window.dispatchEvent(new CustomEvent("codeblack:native-chase-tracking", { detail: currentStatus }));
  return currentStatus;
}

function pointToBreadcrumb(point: NativeChasePoint): BreadcrumbPoint {
  return {
    id: point.id,
    lat: point.lat,
    lon: point.lon,
    timestamp: point.timestamp,
    at: point.at ?? point.timestamp,
    speedMph: point.speedMph ?? null,
    headingDeg: point.headingDeg ?? null,
    sessionId: point.sessionId ?? null,
    accuracyM: point.accuracyM ?? null,
    altitudeM: point.altitudeM ?? null,
    provider: point.provider ?? null,
    source: point.source ?? "native-persistent-location",
    valid: point.valid ?? true,
    stale: point.stale ?? false,
    headingAvailable: point.headingAvailable ?? point.headingDeg != null,
    speedAvailable: point.speedAvailable ?? point.speedMph != null,
  };
}

export function nativeChaseTrackingAvailable() {
  return isAndroidNative();
}

export function getNativeChaseStatus() {
  return currentStatus;
}

export function subscribeNativeChaseTracking(listener: (status: NativeChaseStatus) => void) {
  listeners.add(listener);
  listener(currentStatus);
  return () => {
    listeners.delete(listener);
  };
}

export async function loadNativeChaseStatus() {
  if (!isAndroidNative()) return publish(unavailableStatus());
  try {
    return publish(await ChaseTrackingNative.getStatus());
  } catch (error) {
    return publish({ ...unavailableStatus(), lastError: error instanceof Error ? error.message : "NATIVE_STATUS_FAILED" });
  }
}

export async function startNativeChaseTracking(session: MissionSession, options: { detailPreset?: TrackingDetailPreset } = {}) {
  if (!isAndroidNative()) return publish(unavailableStatus());
  try {
    const permission = await Geolocation.requestPermissions({ permissions: ["location"] });
    if (permission.location === "denied") {
      return publish({ ...currentStatus, active: false, lastError: "LOCATION_PERMISSION_MISSING", locationPermission: "denied" });
    }
  } catch (error) {
    return publish({ ...currentStatus, active: false, lastError: error instanceof Error ? error.message : "LOCATION_PERMISSION_REQUEST_FAILED" });
  }
  void ChaseTrackingNative.requestNotificationPermission()
    .then(publish)
    .catch(() => {
      // Android can still run the foreground service when notification permission is denied;
      // the status panel calls that out instead of blocking the chase session.
    });
  try {
    return publish(await ChaseTrackingNative.start({ sessionId: session.id, startedAt: session.startedAt, trackingPreset: options.detailPreset ?? "balanced" }));
  } catch (error) {
    return publish({ ...currentStatus, active: false, sessionId: session.id, lastError: error instanceof Error ? error.message : "NATIVE_START_FAILED" });
  }
}

export async function stopNativeChaseTracking() {
  if (!isAndroidNative()) return publish(unavailableStatus());
  try {
    const status = await ChaseTrackingNative.stop();
    return publish(status);
  } catch (error) {
    return publish({ ...currentStatus, active: false, lastError: error instanceof Error ? error.message : "NATIVE_STOP_FAILED" });
  }
}

export async function syncNativeChaseBreadcrumbs() {
  if (!isAndroidNative()) return publish(unavailableStatus());
  try {
    const result = await ChaseTrackingNative.getBreadcrumbs();
    const points = Array.isArray(result.points) ? result.points.map(pointToBreadcrumb) : [];
    if (points.length > 0) mergeBreadcrumbPoints(points);
    return publish(result);
  } catch (error) {
    return publish({ ...currentStatus, lastError: error instanceof Error ? error.message : "NATIVE_SYNC_FAILED" });
  }
}
