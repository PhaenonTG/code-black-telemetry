import { Preferences } from "@capacitor/preferences";
import { classifyFetchError, classifyHttpStatus, fetchWithTimeout, normalizeEndpointInput, nextBackoffDelayMs } from "./connection";
import { locationTrackingService, type LocationTrackingStatus } from "./locationTracking";
import {
  createLiveOverlayIngestUrl,
  DEFAULT_LIVE_OVERLAY_PUBLISH_POLICY,
  LIVE_OVERLAY_TELEMETRY_SOURCE,
  shouldPublishLiveOverlayTelemetry,
  type LiveOverlayTelemetryPayload,
  type LiveOverlayTelemetryPublishPolicy,
} from "./liveOverlayTelemetryModel";
import type { LocationObservation } from "./locationObservation";

export type LiveOverlayTelemetryLinkState = "disabled" | "not-configured" | "idle" | "publishing" | "live" | "degraded" | "offline";

export interface LiveOverlayTelemetrySettings {
  enabled: boolean;
  stationId: string;
  stationName: string;
  coreEndpoint: string;
  stationToken: string;
}

export interface LiveOverlayTelemetryStatus {
  state: LiveOverlayTelemetryLinkState;
  stationId: string;
  endpoint: string;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastPublishedAt: number | null;
  failureCount: number;
  retryAt: number | null;
  lastErrorCode: string | null;
  lastErrorSummary: string;
  lastReason: string;
  activeSessionId: string | null;
}

type StatusListener = (status: LiveOverlayTelemetryStatus) => void;
type SettingsListener = (settings: LiveOverlayTelemetrySettings) => void;

interface LiveOverlayTelemetrySender {
  (settings: LiveOverlayTelemetrySettings, payload: LiveOverlayTelemetryPayload, signal: AbortSignal): Promise<void>;
}

interface TimerApi {
  setTimeout(handler: () => void, timeoutMs: number): number;
  clearTimeout(id: number): void;
}

interface PublisherOptions {
  sender?: LiveOverlayTelemetrySender;
  now?: () => number;
  timers?: TimerApi;
  publishPolicy?: LiveOverlayTelemetryPublishPolicy;
}

const LIVE_OVERLAY_TELEMETRY_SETTINGS_KEY = "codeblack.liveOverlayTelemetrySettings";
const DEFAULT_STATION_ID = "CBWX-001";
export const DEFAULT_LIVE_OVERLAY_TELEMETRY_SETTINGS: LiveOverlayTelemetrySettings = {
  enabled: false,
  stationId: DEFAULT_STATION_ID,
  stationName: "Code Black Chase Vehicle",
  coreEndpoint: "",
  stationToken: "",
};

let currentSettings = DEFAULT_LIVE_OVERLAY_TELEMETRY_SETTINGS;
const settingsListeners = new Set<SettingsListener>();

function normalizeStationId(value: string) {
  const stationId = value.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(stationId) ? stationId : DEFAULT_STATION_ID;
}

function normalizeLiveOverlayTelemetrySettings(input: Partial<LiveOverlayTelemetrySettings>): LiveOverlayTelemetrySettings {
  const normalizedEndpoint = normalizeEndpointInput(input.coreEndpoint ?? "");
  return {
    enabled: Boolean(input.enabled),
    stationId: normalizeStationId(input.stationId ?? DEFAULT_STATION_ID),
    stationName: String(input.stationName ?? DEFAULT_LIVE_OVERLAY_TELEMETRY_SETTINGS.stationName).trim().slice(0, 80)
      || DEFAULT_LIVE_OVERLAY_TELEMETRY_SETTINGS.stationName,
    coreEndpoint: normalizedEndpoint.ok ? normalizedEndpoint.endpoint : "",
    stationToken: String(input.stationToken ?? "").trim(),
  };
}

export async function loadLiveOverlayTelemetrySettings() {
  const saved = await Preferences.get({ key: LIVE_OVERLAY_TELEMETRY_SETTINGS_KEY });
  if (saved.value) {
    try {
      currentSettings = normalizeLiveOverlayTelemetrySettings(JSON.parse(saved.value) as Partial<LiveOverlayTelemetrySettings>);
    } catch {
      currentSettings = DEFAULT_LIVE_OVERLAY_TELEMETRY_SETTINGS;
    }
  } else {
    currentSettings = DEFAULT_LIVE_OVERLAY_TELEMETRY_SETTINGS;
  }
  settingsListeners.forEach((listener) => listener(currentSettings));
  return currentSettings;
}

export async function saveLiveOverlayTelemetrySettings(settings: Partial<LiveOverlayTelemetrySettings>) {
  const normalized = normalizeEndpointInput(settings.coreEndpoint ?? currentSettings.coreEndpoint);
  if (!normalized.ok) throw new Error(normalized.errorSummary || "Invalid Core endpoint.");
  currentSettings = normalizeLiveOverlayTelemetrySettings({ ...currentSettings, ...settings, coreEndpoint: normalized.endpoint });
  await Preferences.set({ key: LIVE_OVERLAY_TELEMETRY_SETTINGS_KEY, value: JSON.stringify(currentSettings) });
  settingsListeners.forEach((listener) => listener(currentSettings));
  return currentSettings;
}

export function getLiveOverlayTelemetrySettings() {
  return currentSettings;
}

export function subscribeLiveOverlayTelemetrySettings(listener: SettingsListener) {
  settingsListeners.add(listener);
  listener(currentSettings);
  return () => {
    settingsListeners.delete(listener);
  };
}

function emptyStatus(settings = currentSettings): LiveOverlayTelemetryStatus {
  return {
    state: settings.enabled ? "idle" : "disabled",
    stationId: settings.stationId,
    endpoint: settings.coreEndpoint,
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
}

function isConfigured(settings: LiveOverlayTelemetrySettings) {
  return Boolean(settings.enabled && settings.coreEndpoint && settings.stationId && settings.stationToken);
}

function payloadFromObservation(settings: LiveOverlayTelemetrySettings, observation: LocationObservation): LiveOverlayTelemetryPayload | null {
  if (!observation.sessionId) return null;
  return {
    stationId: settings.stationId,
    sessionId: observation.sessionId,
    timestamp: observation.timestampUtc,
    latitude: observation.latitude,
    longitude: observation.longitude,
    ...(observation.horizontalAccuracyM == null ? {} : { accuracyM: observation.horizontalAccuracyM }),
    ...(observation.speedMps == null ? {} : { speedMps: observation.speedMps }),
    ...(observation.headingDeg == null ? {} : { headingDeg: observation.headingDeg }),
    ...(observation.altitudeM == null ? {} : { altitudeM: observation.altitudeM }),
    source: LIVE_OVERLAY_TELEMETRY_SOURCE,
  };
}

async function postLiveOverlayTelemetry(settings: LiveOverlayTelemetrySettings, payload: LiveOverlayTelemetryPayload, signal: AbortSignal) {
  const response = await fetchWithTimeout(createLiveOverlayIngestUrl(settings.coreEndpoint), 2_500, {
    method: "POST",
    signal,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.stationToken}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const classified = classifyHttpStatus(response.status, response.statusText);
    throw new Error(classified.lastErrorSummary);
  }
}

export class LiveOverlayTelemetryPublisher {
  private readonly sender: LiveOverlayTelemetrySender;
  private readonly now: () => number;
  private readonly timers: TimerApi;
  private readonly publishPolicy: LiveOverlayTelemetryPublishPolicy;
  private readonly statusListeners = new Set<StatusListener>();
  private status: LiveOverlayTelemetryStatus = emptyStatus();
  private trackingStatus: LocationTrackingStatus | null = null;
  private lastAcceptedPayload: LiveOverlayTelemetryPayload | null = null;
  private inFlight: AbortController | null = null;
  private retryTimer: number | null = null;
  private started = false;
  private unsubscribeTracking: (() => void) | null = null;
  private unsubscribeSettings: (() => void) | null = null;

  constructor(options: PublisherOptions = {}) {
    this.sender = options.sender ?? postLiveOverlayTelemetry;
    this.now = options.now ?? (() => Date.now());
    this.timers = options.timers ?? {
      setTimeout: (handler, timeoutMs) => window.setTimeout(handler, timeoutMs),
      clearTimeout: (id) => window.clearTimeout(id),
    };
    this.publishPolicy = options.publishPolicy ?? DEFAULT_LIVE_OVERLAY_PUBLISH_POLICY;
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.unsubscribeSettings = subscribeLiveOverlayTelemetrySettings((settings) => {
      this.status = { ...emptyStatus(settings), lastSuccessAt: this.status.lastSuccessAt, lastPublishedAt: this.status.lastPublishedAt };
      this.publishStatus();
      this.evaluate();
    });
    this.unsubscribeTracking = locationTrackingService.subscribe((status) => {
      this.trackingStatus = status;
      this.evaluate();
    });
    void loadLiveOverlayTelemetrySettings();
    void locationTrackingService.loadStatus();
  }

  stop() {
    this.started = false;
    this.unsubscribeTracking?.();
    this.unsubscribeSettings?.();
    this.unsubscribeTracking = null;
    this.unsubscribeSettings = null;
    this.abortInFlight();
    this.clearRetry();
  }

  subscribe(listener: StatusListener) {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  getStatus() {
    return this.status;
  }

  private evaluate() {
    const settings = currentSettings;
    const tracking = this.trackingStatus;
    this.clearRetry();
    if (!settings.enabled) {
      this.abortInFlight();
      this.setStatus({ state: "disabled", activeSessionId: null, lastReason: "Overlay telemetry sharing is off." });
      return;
    }
    if (!isConfigured(settings)) {
      this.abortInFlight();
      this.setStatus({ state: "not-configured", activeSessionId: null, lastReason: "Core endpoint, station ID, and station token are required." });
      return;
    }
    if (!tracking?.active || !tracking.latestObservation) {
      this.abortInFlight();
      this.lastAcceptedPayload = null;
      this.setStatus({ state: "idle", activeSessionId: tracking?.sessionId ?? null, lastReason: "Waiting for active Chase Mode and current GPS." });
      return;
    }

    const payload = payloadFromObservation(settings, tracking.latestObservation);
    if (!payload) {
      this.setStatus({ state: "idle", activeSessionId: tracking.sessionId, lastReason: "Waiting for a chase session ID before overlay publishing." });
      return;
    }
    const decision = shouldPublishLiveOverlayTelemetry(
      this.lastAcceptedPayload,
      payload,
      this.status.lastPublishedAt,
      this.now(),
      this.publishPolicy,
    );
    if (!decision.publish) return;
    void this.publish(payload, decision.reason ?? "elapsed");
  }

  private async publish(payload: LiveOverlayTelemetryPayload, reason: string) {
    if (this.inFlight) return;
    const settings = currentSettings;
    const controller = new AbortController();
    this.inFlight = controller;
    this.setStatus({
      state: "publishing",
      endpoint: settings.coreEndpoint,
      stationId: settings.stationId,
      lastAttemptAt: this.now(),
      activeSessionId: payload.sessionId,
      lastReason: reason,
    });
    try {
      await this.sender(settings, payload, controller.signal);
      this.lastAcceptedPayload = payload;
      this.setStatus({
        state: "live",
        lastSuccessAt: this.now(),
        lastPublishedAt: this.now(),
        failureCount: 0,
        retryAt: null,
        lastErrorCode: null,
        lastErrorSummary: "",
      });
    } catch (error) {
      const classified = classifyFetchError(error);
      const failureCount = this.status.failureCount + 1;
      const retryAt = this.now() + nextBackoffDelayMs(failureCount, { baseMs: 2_000, maxMs: 30_000 });
      this.setStatus({
        state: failureCount >= 3 ? "offline" : "degraded",
        failureCount,
        retryAt,
        lastErrorCode: classified.lastErrorCode,
        lastErrorSummary: classified.lastErrorSummary,
      });
      this.retryTimer = this.timers.setTimeout(() => {
        this.retryTimer = null;
        this.evaluate();
      }, Math.max(0, retryAt - this.now()));
    } finally {
      this.inFlight = null;
    }
  }

  private setStatus(patch: Partial<LiveOverlayTelemetryStatus>) {
    this.status = {
      ...this.status,
      stationId: currentSettings.stationId,
      endpoint: currentSettings.coreEndpoint,
      ...patch,
    };
    this.publishStatus();
  }

  private publishStatus() {
    this.statusListeners.forEach((listener) => listener(this.status));
  }

  private abortInFlight() {
    this.inFlight?.abort();
    this.inFlight = null;
  }

  private clearRetry() {
    if (this.retryTimer == null) return;
    this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}

export const liveOverlayTelemetryPublisher = new LiveOverlayTelemetryPublisher();

export const __liveOverlayTelemetryTest = {
  normalizeLiveOverlayTelemetrySettings,
  payloadFromObservation,
  isConfigured,
  emptyStatus,
};
