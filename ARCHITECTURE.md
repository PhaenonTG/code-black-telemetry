# Code Black OPS Architecture

## Product Role

Code Black OPS is the chase vehicle tablet interface. It should stay focused on control, status,
map/radar awareness, reporting, and field diagnostics. Vehicle service work belongs on the
Raspberry Pi. Remote aggregation, overlays, production, archival, and multi-user services belong
behind Code Black Core APIs when those systems are available.

## Application Shell

`src/App.tsx` owns the landscape tablet shell:

- seven pager pages: Weather, Operations, Locate, Alerts, Report, Settings, Layers
- bottom dock navigation and page dots
- Android back behavior for expanded radar/modal/page fallback
- persisted page/cockpit preferences
- app pause/resume handling for telemetry

There is no React Router in the current app shell. Historical docs that mention router-based page
navigation are stale.

## Service Boundaries

UI components should continue to read through service hooks and provider APIs.

Primary boundaries:

- `src/services/telemetry/`: BLE-first telemetry provider, HTTP fallback, simulator fallback types
- `src/services/radar.ts`: frontend contract for the native `RadarNative` plugin
- `src/services/settings.ts`: Capacitor Preferences-backed app settings and subscriptions
- `src/services/nearby.ts`, `situational.ts`, `spotters.ts`, `watches.ts`: external weather/places/spotter data
- `src/map/`: Mapbox GL JS layer managers and diagnostics
- `android/app/src/main/java/com/codeblackwx/ops/`: native Android plugins and diagnostic activities

Do not introduce direct Pi, Core, streaming, or provider dependencies into UI components when a
service module can own the contract.

## Telemetry

The active provider is `HybridTelemetryProvider` in `src/services/telemetry/api-provider.ts`.

- BLE is primary through `BleTelemetryClient`.
- HTTP polling of `/api/latest` is a fallback and is skipped while BLE telemetry is fresh.
- Tablet GPS is used as a fallback when vehicle GPS is invalid or stale.
- Last successful telemetry is persisted and shown as last-known/offline state.
- App backgrounding pauses BLE and HTTP work; resume triggers an immediate poll/reconnect attempt.

The BLE command channel is token-gated for lighting and chase-session commands. The token is stored
in Capacitor Preferences by current design; revisit before wider distribution.

## Radar

Production tablet radar is Android-native and on-device:

NOAA/Unidata Level II source -> native Android download -> Rust/JNI decoder -> app-private processed cache -> Mapbox layer.

The Node worker under `radar-worker/` is a local development/reference server. It is not the
production tablet radar path and should not be exposed on a trusted network without an explicit
auth/bind-address review.

## Networking

This checkout does not include the real Pi NetworkManager, hotspot, recovery AP, watchdog, or
systemd definitions. The tablet supports:

- BLE telemetry/commands to the Pi
- optional HTTP Pi endpoint by LAN hostname/IP/Tailscale address
- global Android cleartext allowance for those local/Tailscale HTTP endpoints

Future Pi networking changes should be made in the Pi-side codebase after inspecting the real
profiles and services on the Raspberry Pi.

## Native Android

Capacitor app id: `com.codeblackwx.ops`.

Native components:

- `RadarNativePlugin`: Level II radar download/cache/decode bridge
- `TabletLocationNativePlugin`: last-known Android location bridge
- `NativeMapboxReconActivity`: hardcoded diagnostic/prototype Mapbox activity
- `RadarForegroundService`: declared but currently minimal

Security-sensitive manifest settings currently include app backup enabled, global cleartext HTTP
allowed, and an exported diagnostic recon activity. Treat changes to these as policy decisions.

## Validation

Current supported validation is build/lint/device build oriented:

```powershell
npm run lint
npm run build
npm run android:debug
```

There is no committed unit test framework or test script at this time.
