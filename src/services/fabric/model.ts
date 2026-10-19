import type {
  FabricCapability,
  FabricDeviceState,
  FabricFreshnessThresholds,
  FabricNormalizedState,
  FabricPresenceState,
  FabricUnitState,
} from "./types";

export const DEFAULT_FABRIC_FRESHNESS_THRESHOLDS: FabricFreshnessThresholds = {
  liveMs: 15_000,
  degradedMs: 60_000,
  staleMs: 300_000,
};

export const CODE_BLACK_FABRIC_SCHEMA_VERSION = "1.0.0";

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function deviceAgeMs(device: FabricDeviceState, now = Date.now()): number | null {
  if (typeof device.age_ms === "number" && Number.isFinite(device.age_ms) && device.age_ms >= 0) return device.age_ms;
  if (!isFiniteTimestamp(device.last_seen)) return null;
  return Math.max(0, now - device.last_seen);
}

export function classifyDevicePresence(
  device: FabricDeviceState,
  now = Date.now(),
  thresholds: FabricFreshnessThresholds = DEFAULT_FABRIC_FRESHNESS_THRESHOLDS,
): FabricPresenceState {
  if (device.expected === false) return "NOT_CONFIGURED";
  if (device.health_state === "NOT_CONFIGURED") return "NOT_CONFIGURED";
  if (device.connected === false && !isFiniteTimestamp(device.last_seen)) return "OFFLINE";

  const age = deviceAgeMs(device, now);
  if (age === null) return device.connected ? "DEGRADED" : "OFFLINE";
  if (device.connected === false || device.health_state === "OFFLINE") return "OFFLINE";
  if (age <= thresholds.liveMs) return device.health_state === "DEGRADED" ? "DEGRADED" : "LIVE";
  if (age <= thresholds.degradedMs) return "DEGRADED";
  if (age <= thresholds.staleMs) return "STALE";
  return "OFFLINE";
}

function strongerState(a: FabricPresenceState, b: FabricPresenceState): FabricPresenceState {
  const rank: Record<FabricPresenceState, number> = {
    LIVE: 5,
    DEGRADED: 4,
    STALE: 3,
    OFFLINE: 2,
    NOT_CONFIGURED: 1,
  };
  return rank[a] >= rank[b] ? a : b;
}

export function aggregateUnitPresence(
  devices: FabricDeviceState[],
  now = Date.now(),
  thresholds: FabricFreshnessThresholds = DEFAULT_FABRIC_FRESHNESS_THRESHOLDS,
): FabricPresenceState {
  const configured = devices.filter((device) => classifyDevicePresence(device, now, thresholds) !== "NOT_CONFIGURED");
  if (configured.length === 0) return "NOT_CONFIGURED";

  const states = configured.map((device) => classifyDevicePresence(device, now, thresholds));
  const required = configured.filter((device) => device.required_for_unit);
  const requiredStates = required.map((device) => classifyDevicePresence(device, now, thresholds));
  const best = states.reduce((current, state) => strongerState(current, state), "NOT_CONFIGURED" as FabricPresenceState);

  if (required.length > 0 && requiredStates.every((state) => state === "OFFLINE")) return "OFFLINE";
  if (best === "OFFLINE") return "OFFLINE";
  if (states.every((state) => state === "LIVE")) return "LIVE";
  if (best === "LIVE" || best === "DEGRADED") return "DEGRADED";
  return "STALE";
}

export function unitLastSeen(devices: FabricDeviceState[]): number | null {
  const timestamps = devices.map((device) => device.last_seen).filter(isFiniteTimestamp);
  if (timestamps.length === 0) return null;
  return Math.max(...timestamps);
}

export function mergeCapabilities(devices: FabricDeviceState[], unitCapabilities: FabricCapability[] = []): FabricCapability[] {
  const byId = new Map<string, FabricCapability>();
  for (const capability of unitCapabilities) byId.set(capability.id, capability);
  for (const device of devices) {
    for (const capability of device.capabilities) {
      const existing = byId.get(capability.id);
      const sourceDeviceIds = new Set([...(existing?.sourceDeviceIds ?? []), device.device_id, ...(capability.sourceDeviceIds ?? [])]);
      byId.set(capability.id, { ...existing, ...capability, sourceDeviceIds: Array.from(sourceDeviceIds) });
    }
  }
  return Array.from(byId.values());
}

export function normalizeUnitState(
  unit: Omit<FabricUnitState, "overall_health" | "last_seen" | "capabilities"> & { capabilities?: FabricCapability[] },
  now = Date.now(),
  thresholds: FabricFreshnessThresholds = DEFAULT_FABRIC_FRESHNESS_THRESHOLDS,
): FabricUnitState {
  const devices = unit.devices.map((device) => ({
    ...device,
    age_ms: deviceAgeMs(device, now),
    health_state: classifyDevicePresence(device, now, thresholds),
  }));

  return {
    ...unit,
    capabilities: mergeCapabilities(devices, unit.capabilities),
    devices,
    overall_health: aggregateUnitPresence(devices, now, thresholds),
    last_seen: unitLastSeen(devices),
  };
}

export function createFabricNormalizedState(units: FabricUnitState[], generatedAt = Date.now()): FabricNormalizedState {
  return {
    schema: "codeblack.fabric.unit-state",
    schema_version: CODE_BLACK_FABRIC_SCHEMA_VERSION,
    generated_at: generatedAt,
    units,
    transports: {
      telemetry: {
        lane: "telemetry",
        current_contract: "Normalized UnitState publishers may arrive through gateway-backed or gatewayless adapters.",
        preferred_future_transport: "MQTT over TLS for ESP/Pi publishers.",
        implemented: false,
        deferred: ["MQTT broker deployment", "device token provisioning", "offline spool policy beyond tiny diagnostic buffers"],
      },
      shared_application_state: {
        lane: "shared_application_state",
        current_contract: "REST snapshots/config/history with WebSocket live normalized state as the consumer contract.",
        preferred_future_transport: "REST plus WebSocket from CodeBlack-Core.",
        implemented: false,
        deferred: ["Core WebSocket service", "history persistence", "consumer subscription adapters"],
      },
      commands: {
        lane: "commands",
        current_contract: "Command lane is reserved and intentionally not implemented in Phase 1.",
        preferred_future_transport: "Authenticated Core command bus with local gateway fallback where authorized.",
        implemented: false,
        deferred: ["command authorization", "audit logging", "firmware update", "stream switching", "remote control"],
      },
    },
  };
}
