import { normalizeUnitState } from "./model";
import type { FabricDeviceState, FabricUnitState } from "./types";

const baseTime = Date.parse("2026-09-02T18:00:00Z");

const cap = (id: string) => ({ id });

function strikerPi(lastSeen: number, connected = true): FabricDeviceState {
  return {
    device_id: "cbwx-striker-pi",
    unit_id: "cbwx-unit-striker",
    device_type: "raspberry-pi",
    display_label: "STRIKER Pi",
    capabilities: [cap("network"), cap("system_health"), cap("stream"), cap("camera")],
    software_version: null,
    session_id: "striker-pi-session",
    boot_id: "striker-pi-boot",
    connected,
    required_for_unit: true,
    last_seen: lastSeen,
    transport: { kind: "gateway", path: "gateway-backed", endpointRef: "striker-local-gateway" },
  };
}

function strikerNav(lastSeen: number, connected = true): FabricDeviceState {
  return {
    device_id: "cbwx-striker-nav",
    unit_id: "cbwx-unit-striker",
    device_type: "esp32-navigation",
    display_label: "STRIKER Navigation ESP",
    capabilities: [cap("location"), cap("speed"), cap("heading"), cap("gps")],
    firmware_version: null,
    connected,
    required_for_unit: false,
    last_seen: lastSeen,
    transport: { kind: "gateway", path: "gateway-backed", viaDeviceId: "cbwx-striker-pi" },
  };
}

function strikerWeather(lastSeen: number | null, connected = true): FabricDeviceState {
  return {
    device_id: "cbwx-striker-weather",
    unit_id: "cbwx-unit-striker",
    device_type: "esp32-weather",
    display_label: "STRIKER Weather ESP",
    capabilities: [cap("temperature"), cap("humidity"), cap("wind_speed"), cap("wind_direction")],
    firmware_version: null,
    connected,
    required_for_unit: false,
    last_seen: lastSeen,
    transport: { kind: "gateway", path: "gateway-backed", viaDeviceId: "cbwx-striker-pi" },
  };
}

function tessaNav(lastSeen: number, connected = true): FabricDeviceState {
  return {
    device_id: "cbwx-tessa-nav",
    unit_id: "cbwx-unit-tessa",
    device_type: "esp32-navigation",
    display_label: "TESSA Navigation ESP",
    capabilities: [cap("location"), cap("speed"), cap("heading"), cap("gps")],
    connected,
    required_for_unit: true,
    last_seen: lastSeen,
    transport: { kind: "mqtt", path: "gatewayless", endpointRef: "codeblack-core-telemetry" },
    metadata: {
      wan_behavior: "continue_acquisition_bounded_retry_resume_current_no_required_backlog",
    },
  };
}

function tessaWeather(lastSeen: number, connected = true): FabricDeviceState {
  return {
    device_id: "cbwx-tessa-weather",
    unit_id: "cbwx-unit-tessa",
    device_type: "esp32-weather",
    display_label: "TESSA Weather ESP",
    capabilities: [cap("temperature"), cap("humidity"), cap("wind_speed"), cap("wind_direction")],
    connected,
    required_for_unit: false,
    last_seen: lastSeen,
    transport: { kind: "mqtt", path: "gatewayless", endpointRef: "codeblack-core-telemetry" },
    metadata: {
      wan_behavior: "continue_acquisition_bounded_retry_resume_current_no_required_backlog",
    },
  };
}

function tessaIpad(lastSeen: number, connected = true): FabricDeviceState {
  return {
    device_id: "cbwx-tessa-ops-ipad",
    unit_id: "cbwx-unit-tessa",
    device_type: "ops-ipad",
    display_label: "TESSA OPS iPad",
    capabilities: [cap("location"), cap("network"), cap("system_health")],
    connected,
    required_for_unit: false,
    last_seen: lastSeen,
    transport: { kind: "https", path: "gatewayless", endpointRef: "codeblack-core-app-state" },
  };
}

export const FABRIC_FIXTURE_TIME = baseTime;

export function strikerFullyHealthy(now = FABRIC_FIXTURE_TIME): FabricUnitState {
  return normalizeUnitState({
    unit_id: "cbwx-unit-striker",
    display_name: "STRIKER",
    operator_name: "Spencer",
    unit_type: "chase-platform",
    role: "chase-platform",
    devices: [strikerPi(now), strikerNav(now), strikerWeather(now)],
    metadata: {
      edge_model: "gateway-backed",
      local_resilience: "ESP to Pi and local OPS consumption continue when WAN/Core is unavailable where currently supported.",
      public_overlay_vehicle_name_default: false,
    },
  }, now);
}

export function strikerWeatherOffline(now = FABRIC_FIXTURE_TIME): FabricUnitState {
  return normalizeUnitState({
    unit_id: "cbwx-unit-striker",
    display_name: "STRIKER",
    operator_name: "Spencer",
    unit_type: "chase-platform",
    role: "chase-platform",
    devices: [strikerPi(now), strikerNav(now), strikerWeather(null, false)],
    metadata: {
      edge_model: "gateway-backed",
      local_resilience: "Pi-to-Core recovers independently; local operation is preserved.",
      public_overlay_vehicle_name_default: false,
    },
  }, now);
}

export function tessaFullyHealthy(now = FABRIC_FIXTURE_TIME): FabricUnitState {
  return normalizeUnitState({
    unit_id: "cbwx-unit-tessa",
    display_name: "TESSA",
    operator_name: "Nick",
    unit_type: "chase-platform",
    role: "lead-chase-platform",
    devices: [tessaNav(now), tessaWeather(now), tessaIpad(now)],
    metadata: {
      edge_model: "gatewayless",
      pi_required: false,
      wan_behavior: "ESP sensors continue acquisition without Core and reconnect with bounded retry.",
      public_overlay_vehicle_name_default: false,
    },
  }, now);
}

export function tessaWeatherStale(now = FABRIC_FIXTURE_TIME): FabricUnitState {
  return normalizeUnitState({
    unit_id: "cbwx-unit-tessa",
    display_name: "TESSA",
    operator_name: "Nick",
    unit_type: "chase-platform",
    role: "lead-chase-platform",
    devices: [tessaNav(now), tessaWeather(now - 120_000), tessaIpad(now)],
    metadata: {
      edge_model: "gatewayless",
      pi_required: false,
      wan_behavior: "ESP sensors continue acquisition without Core and reconnect with bounded retry.",
      public_overlay_vehicle_name_default: false,
    },
  }, now);
}

export function tessaCoreDisconnected(now = FABRIC_FIXTURE_TIME): FabricUnitState {
  return normalizeUnitState({
    unit_id: "cbwx-unit-tessa",
    display_name: "TESSA",
    operator_name: "Nick",
    unit_type: "chase-platform",
    role: "lead-chase-platform",
    devices: [
      { ...tessaNav(now - 20_000), connected: false },
      { ...tessaWeather(now - 20_000), connected: false },
      { ...tessaIpad(now - 20_000), connected: false },
    ],
    metadata: {
      edge_model: "gatewayless",
      pi_required: false,
      wan_behavior: "Core connectivity is not required for sensor acquisition; reconnect resumes current telemetry without a large backlog requirement.",
      public_overlay_vehicle_name_default: false,
    },
  }, now);
}

export function tessaCoreReconnected(now = FABRIC_FIXTURE_TIME): FabricUnitState {
  return normalizeUnitState({
    unit_id: "cbwx-unit-tessa",
    display_name: "TESSA",
    operator_name: "Nick",
    unit_type: "chase-platform",
    role: "lead-chase-platform",
    devices: [tessaNav(now), tessaWeather(now), tessaIpad(now)],
    metadata: {
      edge_model: "gatewayless",
      pi_required: false,
      wan_behavior: "Reconnected devices publish current telemetry after bounded retry.",
      public_overlay_vehicle_name_default: false,
    },
  }, now);
}
