# Code Black Fabric Phase 1

This document describes the first implemented layer of the Code Black WX communications fabric: unit identity, device identity, capabilities, presence/freshness semantics, and the normalized Core-facing state contract.

Phase 1 deliberately does not implement a command bus, firmware update path, MARK/ESCAPE redesign, producer controls, stream switching, public website changes, Chaser Net expansion, probe architecture, or Level II radar expansion. OPS radar remains mosaic-first.

## Implemented

- Versioned TypeScript fabric model under `src/services/fabric`.
- Stable unit identifiers:
  - `cbwx-unit-striker` for STRIKER / Spencer.
  - `cbwx-unit-tessa` for TESSA / Nick.
- Stable initial device identifiers:
  - STRIKER: `cbwx-striker-pi`, `cbwx-striker-nav`, `cbwx-striker-weather`, `cbwx-striker-ops-ipad`.
  - TESSA: `cbwx-tessa-nav`, `cbwx-tessa-weather`, `cbwx-tessa-ops-ipad`.
- Presence states: `LIVE`, `DEGRADED`, `STALE`, `OFFLINE`, `NOT_CONFIGURED`.
- Central freshness thresholds:
  - `LIVE`: last seen at or under 15 seconds.
  - `DEGRADED`: over 15 seconds through 60 seconds.
  - `STALE`: over 60 seconds through 300 seconds.
  - `OFFLINE`: over 300 seconds, no timestamp, or explicitly disconnected without recent state.
  - `NOT_CONFIGURED`: expected false or explicitly not configured.
- Unit-level aggregation that does not mark a unit offline merely because one optional device is absent.
- Normalized state envelope `codeblack.fabric.unit-state` version `1.0.0`.
- Standalone fixtures/tests for STRIKER gateway-backed and TESSA gatewayless edge models.

## Existing / Reused

- Existing telemetry freshness and nullable measurement conventions in `src/services/telemetry/types.ts`, `src/services/telemetry/measurement.ts`, and `src/services/telemetry/quality.ts`.
- Existing connection-state distinction between transport reachability and data freshness in `src/services/connection.ts` and `src/services/operationalStatus.ts`.
- Existing system inventory docs and YAML under `config/system` and `docs/system`.
- Existing OPS principle that local chase operation must degrade by capability instead of one global online/offline flag.

## Unit Versus Device Identity

A unit is the operational platform consumers care about: `unit.location`, `unit.weather`, `unit.health`, `unit.devices`, and `unit.capabilities`.

A device is one reporting participant inside a unit. Devices may be direct publishers, gateway-connected sensors, OPS tablets, or local gateways. Device fields are intentionally optional where real firmware or clients cannot provide every value yet.

Required unit concepts:

- `unit_id`
- `display_name`
- `operator_name`
- `unit_type`
- `role`
- `capabilities`
- `devices`
- `overall_health`
- `last_seen`
- `metadata`

Required device concepts:

- `device_id`
- `unit_id`
- `device_type`
- `display_label`
- `capabilities`
- `software_version`
- `firmware_version`
- `session_id`
- `boot_id`
- `connected`
- `last_seen`
- `age_ms`
- `health_state`
- `transport`

## STRIKER - Spencer

STRIKER stable unit id: `cbwx-unit-striker`.

Reference edge model:

```text
Navigation ESP32 --\
Weather ESP32 -----+--> STRIKER Pi --> CodeBlack-Core
local systems -----/
```

STRIKER remains gateway-backed where appropriate. WAN/Core failure must not prevent ESP-to-Pi collection or local OPS consumption where currently supported. The Pi-to-Core transport should recover independently when WAN returns.

Phase 1 does not redesign working local STRIKER behavior to match TESSA. It only defines the normalized state that upstream consumers should see after gateway-backed data reaches Core.

## TESSA - Nick

TESSA stable unit id: `cbwx-unit-tessa`.

Reference edge model:

```text
Navigation ESP32 --> CodeBlack-Core
Weather ESP32 ----> CodeBlack-Core
iPad -------------> CodeBlack-Core
```

TESSA has no Pi dependency in the Phase 1 model. A future Pi can be added later as an optional gateway without changing unit/device/Core contracts.

Expected TESSA ESP WAN behavior:

- Continue sensor acquisition if WAN disappears.
- Do not crash when Core cannot be reached.
- Reconnect automatically with bounded retry/backoff.
- Resume current telemetry after reconnect.
- Do not require a large offline backlog.
- Do not require local persistent telemetry storage.
- A tiny diagnostic memory buffer is allowed later.

## Normalized State

Gateway-backed and gatewayless paths must publish the same normalized unit state shape.

Conceptual paths:

```text
STRIKER: ESP -> Pi -> Core -> normalized UnitState
TESSA:   ESP -> Core -> normalized UnitState
```

Consumers should not need transport-specific logic to read:

- `unit.location`
- `unit.weather`
- `unit.health`
- `unit.devices`
- `unit.capabilities`

## Transport Boundaries

The model prepares three lanes:

- Telemetry: future/default ESP/Pi publisher direction is MQTT over TLS. Phase 1 does not deploy MQTT.
- Shared application state: REST for snapshots/config/history and WebSocket for live normalized state.
- Commands: reserved for future authenticated command work. Phase 1 intentionally leaves commands unimplemented.

## Public Overlay Boundary

Public stream overlays must not introduce vehicle names by default. Phase 1 fixtures include metadata that keeps public vehicle-name display off by default.

## Deferred

- MQTT broker deployment and TLS/device-token provisioning.
- Core REST/WebSocket normalized-state service.
- Command bus, firmware update, stream switching, remote control, and audit logging.
- Physical STRIKER Pi validation.
- Physical TESSA ESP direct-to-Core validation.
- Full canonical telemetry schema migration across OPS, Flutter, ESP firmware, and Core docs.
- UI display of Fabric state.

## Unknown / Needs Live Device Testing

- Whether STRIKER Pi currently publishes enough metadata for `session_id`, `boot_id`, and per-device freshness.
- Whether TESSA ESP firmware exists in the final direct-to-Core form.
- Exact MQTT topic names, certificates, retry intervals, and Core endpoint configuration.
- Physical iPad/Core foreground reconnection behavior against live Core.
- Which existing firmware sources are authoritative for Navigation ESP, Weather ESP, and Wind ESP.

## Phase 2 Core Service Status

Phase 2 implementation belongs in the Core backend foundation, not inside the OPS frontend. The correct service target discovered during the backend audit is:

`C:\Users\glenn\Documents\Code Black\services\core-api`

That Core API service now owns the first working Core-facing Fabric live state implementation:

- Registry for STRIKER / Spencer and TESSA / Nick.
- Current-state manager for registered devices.
- Central presence recalculation.
- Unit aggregation using the Phase 1 presence semantics.
- Validated ingest route: `POST /api/fabric/v1/ingest`.
- REST snapshot routes:
  - `GET /api/fabric/v1/units`
  - `GET /api/fabric/v1/units/{unit_id}`
  - `GET /api/fabric/v1/devices`
  - `GET /api/fabric/v1/devices/{device_id}`
  - `GET /api/fabric/v1/health`
- WebSocket route: `/api/fabric/v1/ws`.
- Event envelope with `event_type`, `schema_version`, `timestamp`, `unit_id`, `device_id`, and `payload`.
- MQTT topic proposal:

```text
cbwx/v1/units/{unit_id}/devices/{device_id}/telemetry
cbwx/v1/units/{unit_id}/devices/{device_id}/presence
```

TESSA remains gatewayless in the registry and has no Pi dependency. STRIKER remains gateway-backed through the STRIKER Pi where appropriate.

Phase 2 is not yet deployed to live Core hardware. Physical STRIKER Pi validation, TESSA direct ESP-to-Core validation, production auth, TLS/MQTT broker setup, and durable persistence remain blocked/deferred.
