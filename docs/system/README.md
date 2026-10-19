# Code Black System

Code Black OPS is a reliability-first storm-chasing operations ecosystem. The vehicle must continue to function locally when internet access, streaming, or CodeBlack-Core is unavailable.

## What Exists

- Root Code Black OPS app: React 19, TypeScript, Vite, Capacitor 8, Android/iOS hosts, Atlas map, telemetry, weather, alerts, operations, settings, and field diagnostics.
- Android host: Capacitor app under `android/` with native Java plugins for chase tracking, secure credentials, tablet location, car app service, and diagnostic Mapbox recon activity.
- iOS/iPadOS host: Capacitor project under `ios/` with Swift secure credential plugin source and foreground location/local network permission text.
- Code Black OPS Web: `web/ops`, a private authenticated web surface using Supabase Auth and reused Atlas/data modules.
- Code Black Control: `web/telemetry`, an early standalone Vite/React control-plane frontend, currently simulator-only.
- Public site: `web/public`, a public brand/status website without private telemetry.
- Radar worker: `radar-worker/worker.cjs`, a development Node API for Level II/III radar products and tiles on port 8787.
- Native radar reference: `native/radar-ref`, a retired/deferred Rust Android radar reference crate.
- Cloudflare Pages Functions: `functions/api/modot` and `functions/api/odot` proxy public road-data providers.

## Devices And Nodes

The canonical inventory is `config/system/nodes.yaml`.

Current known nodes are the Samsung cockpit tablet, Spencer Charger Pi, Navigation ESP, Weather ESP, Windows development/producer PC, future iPhone/iPad cockpit, CodeBlack-Core, future Nick vehicle node, and future probes.

The Pi, ESP firmware, NetworkManager profiles, systemd units, watchdogs, and production Pi backend are not in this checkout. They are documented as external discovery gaps rather than guessed.

## What Runs Where

- Samsung cockpit tablet: root OPS app in Capacitor WebView; native Android services for location/secure storage.
- Future iPhone/iPad: shared Capacitor WebView path with pending native validation.
- Charger Pi: planned vehicle node for telemetry bridges, BLE, HTTP API, networking, streaming, and vehicle control.
- CodeBlack-Core: planned central backend/control authority for ingest, archive, remote producer workflows, fleet, and remote control.
- Windows PC: development, builds, diagnostics, OBS/producer work, and optional development radar worker.

## Required For Chasing

Critical local capabilities are cockpit OPS, Atlas map, radar, and GPS. Important capabilities include vehicle weather, vehicle telemetry, network awareness, and power/system awareness. Optional capabilities include streaming, recording, CodeBlack-Core, Code Black Control, road cameras, and fleet coordination.

Readiness semantics are defined in `config/system/readiness.yaml`.

## Data Flows

Vehicle data:

```text
Navigation ESP / Weather ESP -> Charger Pi -> BLE or HTTP -> OPS tablet
```

Fallback location:

```text
Tablet GPS -> OPS canonical location
```

Weather fallback:

```text
Public station observation -> situational services -> OPS weather/wind UI
```

Remote control future:

```text
Phone/tablet/laptop browser -> Code Black Control -> CodeBlack-Core or direct Charger Pi -> node/service control contract
```

## Control Model

Control is contract-first. The future API shape is documented in `docs/control/control-api.md` and `docs/control/node-contract.md`. No unauthenticated start/stop/reboot endpoints should be implemented. Destructive or disruptive actions need authentication, authorization, audit logging, and confirmation.

Primary control path: authenticated CodeBlack-Core control plane.

Fallback control path: direct local/Tailscale Charger Pi access.

Core must not be required for local chase operation.

## Failure Handling

The system should degrade by capability, not by one global online/offline flag.

Examples:

- Core offline: remote control/archive/fleet degrade; local chase can remain CHASE_CAPABLE.
- Streaming offline: broadcast unavailable; chase unaffected.
- Vehicle GPS offline: tablet GPS fallback, degraded.
- Weather ESP offline: external station/weather fallback, degraded.
- Pi offline: vehicle telemetry/streaming/control degraded; tablet-local map/radar/GPS may continue.

## iOS Portability

Shared contracts must stay platform-neutral:

- `RadarProvider`: Android/iOS/web should hide implementation differences.
- `GPSProvider`: Android native location, iOS Core Location, browser geolocation, and vehicle GPS should normalize into shared status.
- `TelemetryProvider`: BLE, HTTP, WebSocket, and last-known providers should publish the same UI-facing model.
- `CredentialStore`: Android Keystore, iOS Keychain, and future Windows Credential Manager must sit behind a shared interface.

Android service names, notification channels, intents, and foreground-service details are not universal assumptions.

## Fleet Expansion

Fleet nodes and probes should enter through inventories and capability providers before UI feature work. Nick's vehicle and future probes are planned, not implemented in this checkout.

## Canonical Files

- `config/system/nodes.yaml`
- `config/system/services.yaml`
- `config/system/capabilities.yaml`
- `config/system/readiness.yaml`
- `config/system/profiles.yaml`
- `config/system/network.yaml`
- `docs/system/dependency-graph.md`
- `docs/system/chase-critical-matrix.md`
- `docs/control/node-contract.md`
- `docs/control/control-api.md`
- `docs/control/system-doctor.md`
- `docs/control/remote-control.md`
- `docs/control/security-model.md`
- `docs/bootstrap/bootstrap-plan.md`
