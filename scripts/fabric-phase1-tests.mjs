import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function importTs(path) {
  const source = await readFile(path, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
  }).outputText;
  const encoded = Buffer.from(output, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

const fabricModel = await importTs("src/services/fabric/model.ts");

const now = Date.parse("2026-09-02T18:00:00Z");
const cap = (id) => ({ id });
const device = (overrides) => ({
  device_id: overrides.device_id ?? "test-device",
  unit_id: overrides.unit_id ?? "test-unit",
  device_type: overrides.device_type ?? "esp32-weather",
  display_label: overrides.display_label ?? "Test Device",
  capabilities: overrides.capabilities ?? [cap("temperature")],
  connected: true,
  required_for_unit: false,
  last_seen: now,
  ...overrides,
});
const unit = (overrides) => fabricModel.normalizeUnitState({
  unit_id: overrides.unit_id ?? "test-unit",
  display_name: overrides.display_name ?? "TEST",
  operator_name: overrides.operator_name ?? "Tester",
  unit_type: overrides.unit_type ?? "chase-platform",
  role: overrides.role ?? "support",
  devices: overrides.devices ?? [],
  metadata: overrides.metadata ?? {},
}, now);

assert.equal(fabricModel.CODE_BLACK_FABRIC_SCHEMA_VERSION, "1.0.0");
assert.deepEqual(fabricModel.DEFAULT_FABRIC_FRESHNESS_THRESHOLDS, { liveMs: 15000, degradedMs: 60000, staleMs: 300000 });

const strikerHealthy = unit({
  unit_id: "cbwx-unit-striker",
  display_name: "STRIKER",
  operator_name: "Spencer",
  role: "chase-platform",
  devices: [
    device({ device_id: "cbwx-striker-pi", device_type: "raspberry-pi", display_label: "STRIKER Pi", required_for_unit: true, capabilities: [cap("network"), cap("system_health")] }),
    device({ device_id: "cbwx-striker-nav", device_type: "esp32-navigation", display_label: "STRIKER Navigation ESP", capabilities: [cap("location"), cap("gps"), cap("speed"), cap("heading")] }),
    device({ device_id: "cbwx-striker-weather", display_label: "STRIKER Weather ESP", capabilities: [cap("temperature"), cap("humidity"), cap("wind_speed"), cap("wind_direction")] }),
  ],
  metadata: { edge_model: "gateway-backed", public_overlay_vehicle_name_default: false },
});
assert.equal(strikerHealthy.overall_health, "LIVE");
assert.equal(strikerHealthy.unit_id, "cbwx-unit-striker");
assert.equal(strikerHealthy.operator_name, "Spencer");
assert.equal(strikerHealthy.metadata.public_overlay_vehicle_name_default, false);
assert.ok(strikerHealthy.capabilities.some((item) => item.id === "system_health"));

const strikerWeatherOffline = unit({
  unit_id: "cbwx-unit-striker",
  display_name: "STRIKER",
  operator_name: "Spencer",
  role: "chase-platform",
  devices: [
    device({ device_id: "cbwx-striker-pi", device_type: "raspberry-pi", display_label: "STRIKER Pi", required_for_unit: true }),
    device({ device_id: "cbwx-striker-nav", device_type: "esp32-navigation", display_label: "STRIKER Navigation ESP", capabilities: [cap("location"), cap("gps")] }),
    device({ device_id: "cbwx-striker-weather", display_label: "STRIKER Weather ESP", connected: false, last_seen: null, capabilities: [cap("temperature"), cap("wind_speed")] }),
  ],
  metadata: { edge_model: "gateway-backed", local_resilience: "preserve ESP to Pi local path" },
});
assert.equal(strikerWeatherOffline.devices.find((item) => item.device_id === "cbwx-striker-weather").health_state, "OFFLINE");
assert.equal(strikerWeatherOffline.overall_health, "DEGRADED");

const tessaHealthy = unit({
  unit_id: "cbwx-unit-tessa",
  display_name: "TESSA",
  operator_name: "Nick",
  role: "lead-chase-platform",
  devices: [
    device({ device_id: "cbwx-tessa-nav", device_type: "esp32-navigation", display_label: "TESSA Navigation ESP", required_for_unit: true, transport: { kind: "mqtt", path: "gatewayless" }, capabilities: [cap("location"), cap("gps")] }),
    device({ device_id: "cbwx-tessa-weather", display_label: "TESSA Weather ESP", transport: { kind: "mqtt", path: "gatewayless" }, capabilities: [cap("temperature"), cap("humidity"), cap("wind_speed")] }),
    device({ device_id: "cbwx-tessa-ops-ipad", device_type: "ops-ipad", display_label: "TESSA OPS iPad", transport: { kind: "https", path: "gatewayless" }, capabilities: [cap("location"), cap("network")] }),
  ],
  metadata: { edge_model: "gatewayless", pi_required: false },
});
assert.equal(tessaHealthy.overall_health, "LIVE");
assert.equal(tessaHealthy.metadata.pi_required, false);
assert.equal(tessaHealthy.devices.some((item) => item.device_type === "raspberry-pi"), false);
assert.ok(tessaHealthy.devices.every((item) => item.transport.path === "gatewayless"));

const tessaWeatherStale = unit({
  unit_id: "cbwx-unit-tessa",
  display_name: "TESSA",
  operator_name: "Nick",
  role: "lead-chase-platform",
  devices: [
    device({ device_id: "cbwx-tessa-nav", device_type: "esp32-navigation", required_for_unit: true }),
    device({ device_id: "cbwx-tessa-weather", last_seen: now - 120000 }),
    device({ device_id: "cbwx-tessa-ops-ipad", device_type: "ops-ipad" }),
  ],
  metadata: { edge_model: "gatewayless", pi_required: false },
});
assert.equal(tessaWeatherStale.devices.find((item) => item.device_id === "cbwx-tessa-weather").health_state, "STALE");
assert.equal(tessaWeatherStale.overall_health, "DEGRADED");

const tessaCoreDisconnected = unit({
  unit_id: "cbwx-unit-tessa",
  display_name: "TESSA",
  operator_name: "Nick",
  role: "lead-chase-platform",
  devices: [
    device({ device_id: "cbwx-tessa-nav", connected: false, required_for_unit: true, last_seen: now - 20000, metadata: { wan_behavior: "continue sensor acquisition; bounded retry; no required backlog" } }),
    device({ device_id: "cbwx-tessa-weather", connected: false, last_seen: now - 20000, metadata: { wan_behavior: "continue sensor acquisition; bounded retry; no required backlog" } }),
    device({ device_id: "cbwx-tessa-ops-ipad", connected: false, last_seen: now - 20000 }),
  ],
  metadata: { edge_model: "gatewayless", pi_required: false },
});
assert.equal(tessaCoreDisconnected.overall_health, "OFFLINE");
assert.equal(tessaCoreDisconnected.devices.find((item) => item.device_id === "cbwx-tessa-nav").metadata.wan_behavior.includes("continue sensor acquisition"), true);

const tessaReconnected = unit({
  unit_id: "cbwx-unit-tessa",
  display_name: "TESSA",
  operator_name: "Nick",
  role: "lead-chase-platform",
  devices: [
    device({ device_id: "cbwx-tessa-nav", required_for_unit: true }),
    device({ device_id: "cbwx-tessa-weather" }),
    device({ device_id: "cbwx-tessa-ops-ipad", device_type: "ops-ipad" }),
  ],
  metadata: { edge_model: "gatewayless", pi_required: false },
});
assert.equal(tessaReconnected.overall_health, "LIVE");

assert.equal(fabricModel.classifyDevicePresence(device({ last_seen: now }), now), "LIVE");
assert.equal(fabricModel.classifyDevicePresence(device({ last_seen: now - 20000 }), now), "DEGRADED");
assert.equal(fabricModel.classifyDevicePresence(device({ last_seen: now - 120000 }), now), "STALE");
assert.equal(fabricModel.classifyDevicePresence(device({ last_seen: now - 600000 }), now), "OFFLINE");
assert.equal(fabricModel.classifyDevicePresence(device({ expected: false, last_seen: null }), now), "NOT_CONFIGURED");

const unitWithUnknownCapability = unit({
  devices: [device({ device_id: "unknown-cap-device", capabilities: [cap("temperature"), cap("future_probe_density")] })],
});
assert.equal(unitWithUnknownCapability.overall_health, "LIVE");
assert.ok(unitWithUnknownCapability.capabilities.some((item) => item.id === "future_probe_density"));

const optionalAbsent = unit({
  devices: [
    device({ device_id: "required-live", required_for_unit: true }),
    device({ device_id: "optional-camera", device_type: "camera", connected: false, expected: false, last_seen: null, capabilities: [cap("camera")] }),
  ],
});
assert.equal(optionalAbsent.devices.find((item) => item.device_id === "optional-camera").health_state, "NOT_CONFIGURED");
assert.equal(optionalAbsent.overall_health, "LIVE");

const normalizedState = fabricModel.createFabricNormalizedState([strikerHealthy, tessaHealthy], now);
assert.equal(normalizedState.schema, "codeblack.fabric.unit-state");
assert.equal(normalizedState.schema_version, "1.0.0");
assert.equal(normalizedState.units[0].devices[0].age_ms, 0);
assert.equal(normalizedState.transports.telemetry.preferred_future_transport, "MQTT over TLS for ESP/Pi publishers.");
assert.equal(normalizedState.transports.commands.implemented, false);

console.log("fabric-phase1-tests: ok");
