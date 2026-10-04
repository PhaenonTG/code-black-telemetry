# Fabric-backed livestream overlay readiness

Status checked 2026-10-04. Do not treat a reachable feed as proof of a live vehicle.

## Authority and public boundary

- Core `FabricCurrentStateStore` is the authority for current unit/device presence and position.
- Authenticated OPS receives bounded snapshots through `/api/core/api/fabric/v1/stream` over the private VPC service binding. Its 44-second reconnect rechecks the OPS session.
- The existing public TESSA GPS route, `/api/chase/location/public?unit_id=cbwx-unit-tessa`, is a read-only Fabric projection. It does not expose the raw Fabric snapshot or device metadata. STRIKER is intentionally not public through this route.
- The classic-v2 overlay reads that public GPS projection and the narrow, public point-based Storm Intel relay. Do not point an OBS browser source at `/api/core/*`, publish bearer tokens in overlay URLs, or expose raw unit/device state.
- Respect `location_sharing=false` and stale/no-fix responses. Never substitute fixture, simulator, or last-known position as a live fix.

## Go/no-go checks before broadcast

1. Confirm Core API, MQTT broker/bridge, and the private gateway are healthy. OPS System should say `FABRIC FEED OPEN`; this means transport only.
2. On the actual publishing device, enable the existing `LOCATION / SHARING` feature for the intended unit while stationary, then confirm the app reports a recent successful send. Do not use the separate Samsung Android Auto test phone as a substitute without identifying it as the intended publisher.
3. Confirm the intended Fabric device changes from `OFFLINE` to `LIVE`, with `last_seen` advancing across at least three natural heartbeats. Do not inject simulated telemetry into production.
4. Confirm the public projection returns `location_sharing=true`, `stale=false`, and a fix for the intended unit. Do not print, screenshot, or paste the coordinates during routine checks.
5. Stop sharing on the device. Confirm the public route returns `location_sharing=false` and the overlay removes position-dependent content. Re-enable sharing only when broadcasting is intended.
6. Verify the OBS overlay URL and program-feed embed source with a real test broadcast. The OPS `/stream` page remains explicitly unconfigured until a public embeddable source is provided.

## Current blockers

- STRIKER and TESSA have no current Fabric observations after the latest Core restart; both are `OFFLINE`, with no `last_seen`. The software transport is ready, but a real publisher must resume.
- Only TESSA has an approved public GPS route. Publishing STRIKER location or vehicle identity requires a separate privacy decision and Worker-side change.
- No embeddable public broadcast URL is configured for OPS `/stream`.

Avoid adding a second public Fabric API. The existing public projection is the approved boundary for the current TESSA overlay; expand it only for a specific, reviewed broadcast requirement.
