import { getBleCommandToken, getPiEndpoint } from "./settings";
import { bleTelemetryClient } from "./telemetry/ble-client";
import { classifyFetchError, classifyHttpStatus, fetchWithTimeout, normalizeEndpointOrEmpty } from "./connection";

export type StreamState = "OFF" | "STARTING" | "LIVE" | "DEGRADED" | "RECONNECTING" | "FAILED";
export type StreamControlTarget = "knwa" | "codeBlack" | "recording";
export type StreamControlAction = "start" | "stop";
export type StreamTransport = "ble" | "http";

export interface StreamTargetStatus {
  state: StreamState;
  desiredOn: boolean;
  updatedAt: number | null;
  error: string;
  bitrateKbps: number | null;
  fps: number | null;
  resolution: string;
  reconnectCount: number | null;
  storageWarning: string;
}

export interface CameraStatus {
  available: boolean | null;
  label: string;
  updatedAt: number | null;
  error: string;
  resolution: string;
  fps: number | null;
}

export interface MissionStreamStatus {
  camera: CameraStatus;
  knwa: StreamTargetStatus;
  codeBlack: StreamTargetStatus;
  recording: StreamTargetStatus;
  fetchedAt: number;
  stale: boolean;
  error: string;
}

export interface StreamCommandResult {
  transport: StreamTransport;
  message: string;
}

const STATUS_TIMEOUT_MS = 2_500;
const COMMAND_TIMEOUT_MS = 7_000;

const TARGETS: Record<StreamControlTarget, { path: string; bleStart: string; bleStop: string }> = {
  knwa: { path: "knwa", bleStart: "stream.knwa.start", bleStop: "stream.knwa.stop" },
  codeBlack: { path: "code-black", bleStart: "stream.code_black.start", bleStop: "stream.code_black.stop" },
  recording: { path: "recording", bleStart: "recording.start", bleStop: "recording.stop" },
};

function emptyTarget(): StreamTargetStatus {
  return {
    state: "OFF",
    desiredOn: false,
    updatedAt: null,
    error: "",
    bitrateKbps: null,
    fps: null,
    resolution: "",
    reconnectCount: null,
    storageWarning: "",
  };
}

function unknownCamera(): CameraStatus {
  return {
    available: null,
    label: "UNKNOWN",
    updatedAt: null,
    error: "",
    resolution: "",
    fps: null,
  };
}

function configuredBase(): string {
  const configured = getPiEndpoint();
  const envBase = (import.meta.env.VITE_PI_API_BASE as string | undefined)?.trim().replace(/\/$/, "") ?? "";
  return normalizeEndpointOrEmpty(configured || envBase);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function pickChildRecord(raw: unknown, keys: string[]): Record<string, unknown> | null {
  const root = asRecord(raw);
  for (const key of keys) {
    const value = root[key];
    if (value && typeof value === "object") return value as Record<string, unknown>;
  }
  return null;
}

function readString(raw: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string") return value.trim();
  }
  return "";
}

function readNumber(raw: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function readBool(raw: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      if (/^(true|yes|on|enabled|active|live|recording)$/i.test(value)) return true;
      if (/^(false|no|off|disabled|inactive)$/i.test(value)) return false;
    }
  }
  return null;
}

function readTimestamp(raw: Record<string, unknown>): number | null {
  const value = raw.updatedAt ?? raw.updated_at ?? raw.timestamp ?? raw.time;
  if (typeof value === "number" && Number.isFinite(value)) return value > 1_000_000_000_000 ? value : value * 1000;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeState(value: string): StreamState {
  const state = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (state === "STARTING" || state === "LIVE" || state === "DEGRADED" || state === "RECONNECTING" || state === "FAILED" || state === "OFF") return state;
  if (state === "ON" || state === "ACTIVE" || state === "RUNNING" || state === "RECORDING") return "LIVE";
  if (state === "ERROR") return "FAILED";
  return "OFF";
}

function normalizeTarget(raw: unknown): StreamTargetStatus {
  const record = asRecord(raw);
  const state = normalizeState(readString(record, ["state", "status", "streamState", "stream_state", "health"]));
  const explicitDesired = readBool(record, ["desiredOn", "desired_on", "desired", "enabled", "targetOn", "target_on"]);
  const desiredOn = explicitDesired ?? (state === "STARTING" || state === "LIVE" || state === "DEGRADED" || state === "RECONNECTING");
  const width = readNumber(record, ["width"]);
  const height = readNumber(record, ["height"]);
  const explicitResolution = readString(record, ["resolution", "videoResolution", "video_resolution"]);
  return {
    state,
    desiredOn,
    updatedAt: readTimestamp(record),
    error: readString(record, ["error", "lastError", "last_error", "message"]),
    bitrateKbps: readNumber(record, ["bitrateKbps", "bitrate_kbps", "kbps", "bitrate"]),
    fps: readNumber(record, ["fps", "frameRate", "frame_rate"]),
    resolution: explicitResolution || (width && height ? `${width}x${height}` : ""),
    reconnectCount: readNumber(record, ["reconnectCount", "reconnect_count", "reconnects"]),
    storageWarning: readString(record, ["storageWarning", "storage_warning", "diskWarning", "disk_warning"]),
  };
}

function normalizeCamera(raw: unknown): CameraStatus {
  const record = asRecord(raw);
  const status = readString(record, ["state", "status", "cameraState", "camera_state", "ingest", "signal"]);
  const available = readBool(record, ["available", "ready", "connected", "online", "hasSignal", "has_signal"]);
  const upper = status.toUpperCase().replace(/[\s-]+/g, "_");
  const resolvedAvailable = available ?? (upper === "READY" || upper === "LIVE" || upper === "CONNECTED" || upper === "AVAILABLE");
  const width = readNumber(record, ["width"]);
  const height = readNumber(record, ["height"]);
  const explicitResolution = readString(record, ["resolution", "videoResolution", "video_resolution"]);
  return {
    available: status || available !== null ? resolvedAvailable : null,
    label: status ? (resolvedAvailable ? "READY" : upper || "NO SIGNAL") : available === null ? "UNKNOWN" : resolvedAvailable ? "READY" : "NO SIGNAL",
    updatedAt: readTimestamp(record),
    error: readString(record, ["error", "lastError", "last_error", "message"]),
    resolution: explicitResolution || (width && height ? `${width}x${height}` : ""),
    fps: readNumber(record, ["fps", "frameRate", "frame_rate"]),
  };
}

async function fetchJson(url: string, timeoutMs: number, options: RequestInit = {}): Promise<unknown> {
  try {
    const response = await fetchWithTimeout(url, timeoutMs, options);
    if (!response.ok) {
      const classified = classifyHttpStatus(response.status, response.statusText);
      throw new Error(classified.lastErrorSummary);
    }
    return await response.json().catch(() => ({}));
  } catch (error) {
    if (error instanceof Error && /^(HTTP|Authentication)/.test(error.message)) throw error;
    const classified = classifyFetchError(error);
    throw new Error(classified.lastErrorSummary);
  }
}

export function emptyMissionStreamStatus(error = ""): MissionStreamStatus {
  return {
    camera: unknownCamera(),
    knwa: emptyTarget(),
    codeBlack: emptyTarget(),
    recording: emptyTarget(),
    fetchedAt: 0,
    stale: true,
    error,
  };
}

export async function getMissionStreamStatus(): Promise<MissionStreamStatus> {
  const base = configuredBase();
  if (!base) throw new Error("Pi endpoint not configured");
  const fetchedAt = Date.now();
  try {
    const aggregate = await fetchJson(`${base}/api/local/stream/status`, STATUS_TIMEOUT_MS);
    const status = normalizeMissionStreamStatus(aggregate, fetchedAt);
    if (status.camera.label !== "UNKNOWN") return status;
    const camera = await fetchJson(`${base}/api/local/stream/camera`, STATUS_TIMEOUT_MS).catch(() => null);
    return camera ? { ...status, camera: normalizeCamera(camera) } : status;
  } catch {
    const [camera, knwa, codeBlack, recording] = await Promise.allSettled([
      fetchJson(`${base}/api/local/stream/camera`, STATUS_TIMEOUT_MS),
      fetchJson(`${base}/api/local/stream/knwa`, STATUS_TIMEOUT_MS),
      fetchJson(`${base}/api/local/stream/code-black`, STATUS_TIMEOUT_MS),
      fetchJson(`${base}/api/local/stream/recording`, STATUS_TIMEOUT_MS),
    ]);
    const ok = [camera, knwa, codeBlack, recording].some((result) => result.status === "fulfilled");
    if (!ok) throw new Error("Pi stream status unavailable");
    return {
      camera: camera.status === "fulfilled" ? normalizeCamera(camera.value) : unknownCamera(),
      knwa: knwa.status === "fulfilled" ? normalizeTarget(knwa.value) : emptyTarget(),
      codeBlack: codeBlack.status === "fulfilled" ? normalizeTarget(codeBlack.value) : emptyTarget(),
      recording: recording.status === "fulfilled" ? normalizeTarget(recording.value) : emptyTarget(),
      fetchedAt,
      stale: false,
      error: "",
    };
  }
}

export function normalizeMissionStreamStatus(raw: unknown, fetchedAt = Date.now()): MissionStreamStatus {
  const source = pickChildRecord(raw, ["streams", "streaming", "targets"]) ?? asRecord(raw);
  return {
    camera: normalizeCamera(pickChildRecord(source, ["camera", "ingest", "source"]) ?? {}),
    knwa: normalizeTarget(pickChildRecord(source, ["knwa", "KNWA"]) ?? {}),
    codeBlack: normalizeTarget(pickChildRecord(source, ["codeBlack", "code_black", "code-black", "codeblack"]) ?? {}),
    recording: normalizeTarget(pickChildRecord(source, ["recording", "rec"]) ?? {}),
    fetchedAt,
    stale: false,
    error: "",
  };
}

export async function sendStreamControl(target: StreamControlTarget, action: StreamControlAction, bleConnected: boolean): Promise<StreamCommandResult> {
  const token = getBleCommandToken();
  if (!token) throw new Error("Set the command token in Settings first.");
  const config = TARGETS[target];
  if (bleConnected) {
    const response = await bleTelemetryClient.sendCommand(action === "start" ? config.bleStart : config.bleStop);
    if (response.status !== "OK") throw new Error(response.reason || response.status || "Stream command rejected");
    return { transport: "ble", message: "Command sent over BLE." };
  }

  const base = configuredBase();
  if (!base) throw new Error("Pi endpoint not configured");
  const body = JSON.stringify({ token });
  await fetchJson(`${base}/api/local/stream/${config.path}/${action}`, COMMAND_TIMEOUT_MS, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CodeBlack-Command-Token": token,
    },
    body,
  });
  return { transport: "http", message: "Command sent over Pi HTTP." };
}
