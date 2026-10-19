import type { ConnectionStatus } from "./connection";
import type { StatusData, TelemetrySnapshot } from "./telemetry/types";

export type OperationalState =
  | "READY"
  | "LIVE"
  | "CONNECTED"
  | "AGING"
  | "STALE"
  | "DEGRADED"
  | "OFFLINE"
  | "UNAVAILABLE"
  | "NOT_CONFIGURED"
  | "ERROR"
  | "DISABLED"
  | "NO_DATA"
  | "OUTSIDE_COVERAGE"
  | "CHECKING";

export interface OperationalStatusLine {
  state: OperationalState;
  label: string;
  detail: string;
  ageLabel: string;
}

export interface PiOperationalSummary {
  modeLabel: string;
  transport: OperationalStatusLine;
  telemetry: OperationalStatusLine;
  services: OperationalStatusLine;
}

export function formatOperationalAgeFromMs(ageMs: number | null | undefined): string {
  if (ageMs == null || !Number.isFinite(ageMs) || ageMs < 0) return "NO DATA";
  if (ageMs < 5_000) return "NOW";
  if (ageMs < 60_000) return `${Math.round(ageMs / 1000)}s`;
  if (ageMs < 90 * 60_000) return `${Math.round(ageMs / 60_000)}m`;
  return `${Math.round(ageMs / 3_600_000)}h`;
}

export function formatOperationalAge(timestamp: number | null | undefined, now = Date.now()): string {
  if (!timestamp || !Number.isFinite(timestamp) || timestamp <= 0) return "NO DATA";
  return formatOperationalAgeFromMs(Math.max(0, now - timestamp));
}

export function observationStateFromTimestamp(
  timestamp: number | null | undefined,
  now = Date.now(),
  policy: { agingMs: number; staleMs: number; offlineMs?: number } = { agingMs: 30_000, staleMs: 180_000 },
): OperationalState {
  if (!timestamp || !Number.isFinite(timestamp) || timestamp <= 0) return "NO_DATA";
  const age = Math.max(0, now - timestamp);
  if (age <= policy.agingMs) return "LIVE";
  if (age <= policy.staleMs) return "AGING";
  if (policy.offlineMs && age > policy.offlineMs) return "OFFLINE";
  return "STALE";
}

export function summarizeConnectionTransport(connection: ConnectionStatus | null | undefined): OperationalStatusLine {
  if (!connection) {
    return { state: "CHECKING", label: "CHECKING", detail: "Connection status not loaded yet.", ageLabel: "NO DATA" };
  }
  if (!connection.isConfigured || connection.connectionState === "NOT_CONFIGURED") {
    return { state: "NOT_CONFIGURED", label: "NOT CONFIGURED", detail: "Endpoint is not configured.", ageLabel: "NO DATA" };
  }
  if (connection.connectionState === "CONNECTED") {
    const latency = connection.latencyMs == null ? "" : ` · ${connection.latencyMs} ms`;
    return {
      state: "CONNECTED",
      label: `CONNECTED${latency}`,
      detail: "Endpoint is reachable.",
      ageLabel: formatOperationalAge(connection.lastSuccessfulResponseAt),
    };
  }
  if (connection.connectionState === "CONNECTING") {
    return { state: "CHECKING", label: "CONNECTING", detail: "Connection check in progress.", ageLabel: "NO DATA" };
  }
  if (connection.connectionState === "STALE") {
    return {
      state: "STALE",
      label: `STALE · DATA ${formatOperationalAgeFromMs(connection.dataAgeMs)}`,
      detail: connection.lastErrorSummary || "Last data is stale.",
      ageLabel: formatOperationalAge(connection.lastSuccessfulResponseAt),
    };
  }
  if (connection.connectionState === "DEGRADED") {
    return {
      state: "DEGRADED",
      label: "DEGRADED",
      detail: connection.lastErrorSummary || "Connection is partially healthy.",
      ageLabel: formatOperationalAge(connection.lastSuccessfulResponseAt),
    };
  }
  if (connection.connectionState === "ERROR") {
    return {
      state: "ERROR",
      label: connection.lastErrorCode || "ERROR",
      detail: connection.lastErrorSummary || "Connection failed.",
      ageLabel: formatOperationalAge(connection.lastSuccessfulResponseAt),
    };
  }
  return {
    state: "OFFLINE",
    label: connection.retryAt ? `OFFLINE · RETRY ${formatOperationalAgeFromMs(connection.retryAt - Date.now())}` : "OFFLINE",
    detail: connection.lastErrorSummary || "Endpoint is unreachable.",
    ageLabel: formatOperationalAge(connection.lastSuccessfulResponseAt),
  };
}

export function summarizeTelemetryData(status: StatusData | null | undefined, now = Date.now()): OperationalStatusLine {
  if (!status) return { state: "CHECKING", label: "CHECKING", detail: "Telemetry status not loaded yet.", ageLabel: "NO DATA" };
  const connection = status.connection;
  const state = observationStateFromTimestamp(connection?.lastDataAt ?? null, now, { agingMs: 30_000, staleMs: 180_000, offlineMs: 10 * 60_000 });
  if (state === "NO_DATA") {
    return { state: "NO_DATA", label: "NO DATA", detail: "No telemetry observation has been received.", ageLabel: "NO DATA" };
  }
  const ageLabel = formatOperationalAge(connection?.lastDataAt ?? null, now);
  if (state === "LIVE") return { state, label: `LIVE · ${ageLabel}`, detail: "Latest telemetry observation is fresh.", ageLabel };
  if (state === "AGING") return { state, label: `AGING · ${ageLabel}`, detail: "Latest telemetry observation is aging.", ageLabel };
  if (state === "STALE") return { state, label: `STALE · ${ageLabel}`, detail: "Latest telemetry observation is stale.", ageLabel };
  return { state: "OFFLINE", label: `OFFLINE · ${ageLabel}`, detail: "Telemetry has aged beyond the offline threshold.", ageLabel };
}

export function summarizeServicesFromSensors(snapshot: Pick<TelemetrySnapshot, "sensors" | "status"> | null | undefined, now = Date.now()): OperationalStatusLine {
  if (!snapshot) return { state: "CHECKING", label: "CHECKING", detail: "Sensor status not loaded yet.", ageLabel: "NO DATA" };
  if (!snapshot.status.connection.isConfigured) {
    return { state: "NOT_CONFIGURED", label: "NOT CONFIGURED", detail: "Pi/ESP endpoint is not configured.", ageLabel: "NO DATA" };
  }
  if (snapshot.sensors.length === 0) {
    return { state: "NO_DATA", label: "NO DATA", detail: "No sensor nodes have reported.", ageLabel: "NO DATA" };
  }
  const newest = Math.max(...snapshot.sensors.map((sensor) => sensor.lastPacketAt || 0));
  const dataState = observationStateFromTimestamp(newest, now, { agingMs: 15_000, staleMs: 90_000, offlineMs: 5 * 60_000 });
  const ageLabel = formatOperationalAge(newest, now);
  if (dataState === "LIVE" || dataState === "AGING") {
    return { state: dataState, label: `${dataState} · ${ageLabel}`, detail: "Sensor node packets are being received.", ageLabel };
  }
  if (dataState === "STALE") return { state: "STALE", label: `STALE · ${ageLabel}`, detail: "Sensor node packets are stale.", ageLabel };
  return { state: "OFFLINE", label: newest ? `OFFLINE · ${ageLabel}` : "OFFLINE", detail: "Sensor nodes are offline or not reporting.", ageLabel };
}

export function summarizePiOperationalStatus(snapshot: Pick<TelemetrySnapshot, "sensors" | "status"> | null | undefined, now = Date.now()): PiOperationalSummary {
  const transport = summarizeConnectionTransport(snapshot?.status.connection);
  const telemetry = summarizeTelemetryData(snapshot?.status, now);
  const services = summarizeServicesFromSensors(snapshot, now);
  const mode = snapshot?.status.mode;
  return {
    modeLabel: mode === "pi" ? "VEHICLE NODE MODE" : mode === "simulator" ? "DEVELOPMENT SIMULATOR" : "STANDALONE DEVICE MODE",
    transport,
    telemetry,
    services,
  };
}

export function stateTone(state: OperationalState): "ok" | "warn" | "bad" | "neutral" {
  if (state === "LIVE" || state === "CONNECTED" || state === "READY") return "ok";
  if (state === "AGING" || state === "STALE" || state === "DEGRADED" || state === "CHECKING") return "warn";
  if (state === "ERROR" || state === "OFFLINE") return "bad";
  return "neutral";
}

export function providerLayerStatusLabel(status: string): string {
  if (status === "ready") return "LIVE";
  if (status === "stale") return "STALE";
  if (status === "empty") return "NO DATA";
  if (status === "outside-coverage") return "OUTSIDE COVERAGE";
  if (status === "not-configured") return "NOT CONFIGURED";
  if (status === "unavailable") return "PROVIDER UNAVAILABLE";
  if (status === "error") return "ERROR";
  return status.toUpperCase();
}

export function overlayStateLabel(state: string): string {
  if (state === "disabled") return "DISABLED";
  if (state === "not-configured") return "NOT CONFIGURED";
  if (state === "idle") return "READY";
  if (state === "publishing") return "CONNECTING";
  return state.replace("-", " ").toUpperCase();
}
