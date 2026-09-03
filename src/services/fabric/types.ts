export type FabricPresenceState = "LIVE" | "DEGRADED" | "STALE" | "OFFLINE" | "NOT_CONFIGURED";

export type FabricUnitId = "cbwx-unit-striker" | "cbwx-unit-tessa" | (string & {});
export type FabricDeviceId =
  | "cbwx-striker-pi"
  | "cbwx-striker-nav"
  | "cbwx-striker-weather"
  | "cbwx-striker-ops-ipad"
  | "cbwx-tessa-nav"
  | "cbwx-tessa-weather"
  | "cbwx-tessa-ops-ipad"
  | (string & {});

export type FabricUnitType = "chase-platform" | "core" | "producer" | "probe" | "station" | (string & {});
export type FabricUnitRole = "lead-chase-platform" | "chase-platform" | "support" | "core" | "producer" | (string & {});

export type FabricDeviceType =
  | "raspberry-pi"
  | "esp32-navigation"
  | "esp32-weather"
  | "ops-ipad"
  | "ops-android"
  | "core"
  | "producer-workstation"
  | (string & {});

export type FabricTransportKind = "mqtt" | "https" | "websocket" | "ble" | "local-http" | "serial" | "gateway" | "unknown";

export type FabricCapabilityId =
  | "location"
  | "speed"
  | "heading"
  | "temperature"
  | "humidity"
  | "wind_speed"
  | "wind_direction"
  | "vehicle_voltage"
  | "power"
  | "camera"
  | "stream"
  | "network"
  | "gps"
  | "system_health"
  | (string & {});

export interface FabricFreshnessThresholds {
  liveMs: number;
  degradedMs: number;
  staleMs: number;
}

export interface FabricCapability {
  id: FabricCapabilityId;
  label?: string;
  optional?: boolean;
  sourceDeviceIds?: FabricDeviceId[];
  metadata?: Record<string, unknown>;
}

export interface FabricTransportMetadata {
  kind: FabricTransportKind;
  path: "gateway-backed" | "gatewayless" | "local-only" | "unknown";
  viaDeviceId?: FabricDeviceId | null;
  endpointRef?: string | null;
  protocolVersion?: string | null;
}

export interface FabricDeviceState {
  device_id: FabricDeviceId;
  unit_id: FabricUnitId;
  device_type: FabricDeviceType;
  display_label: string;
  capabilities: FabricCapability[];
  software_version?: string | null;
  firmware_version?: string | null;
  session_id?: string | null;
  boot_id?: string | null;
  connected?: boolean | null;
  expected?: boolean;
  required_for_unit?: boolean;
  last_seen?: number | null;
  age_ms?: number | null;
  health_state?: FabricPresenceState;
  transport?: FabricTransportMetadata;
  metadata?: Record<string, unknown>;
}

export interface FabricUnitState {
  unit_id: FabricUnitId;
  display_name: string;
  operator_name: string;
  unit_type: FabricUnitType;
  role: FabricUnitRole;
  capabilities: FabricCapability[];
  devices: FabricDeviceState[];
  overall_health: FabricPresenceState;
  last_seen: number | null;
  metadata?: Record<string, unknown>;
  location?: Record<string, unknown> | null;
  weather?: Record<string, unknown> | null;
  health?: Record<string, unknown> | null;
}

export interface FabricNormalizedState {
  schema: "codeblack.fabric.unit-state";
  schema_version: "1.0.0";
  generated_at: number;
  units: FabricUnitState[];
  transports: {
    telemetry: FabricTransportBoundary;
    shared_application_state: FabricTransportBoundary;
    commands: FabricTransportBoundary;
  };
}

export interface FabricTransportBoundary {
  lane: "telemetry" | "shared_application_state" | "commands";
  current_contract: string;
  preferred_future_transport: string;
  implemented: boolean;
  deferred: string[];
}
