# Code Black OPS Architecture

## Product Role

Code Black OPS is the chase vehicle operations interface. The shared product targets iPhone,
iPad, Android phone/tablet, and Windows/PWA surfaces through common domain/UI code plus thin
platform adapters. It should stay focused on control, status,
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
- `src/services/streaming.ts`: Mission Streaming status normalization and BLE/HTTP control client
- `src/services/settings.ts`: Capacitor Preferences-backed app settings and subscriptions
- `src/services/platformCapabilities.ts`, `locationTracking.ts`, `displayControlService.ts`,
  `notificationService.ts`: platform-neutral capability and adapter boundaries
- `src/services/nearby.ts`, `situational.ts`, `spotters.ts`, `watches.ts`: external weather/places/spotter data
- `src/map/`: Mapbox GL JS layer managers and diagnostics
- `android/app/src/main/java/com/codeblackwx/ops/`: native Android plugins and diagnostic activities
- `ios/App/App.xcodeproj`: Capacitor iOS/iPadOS host using Swift Package Manager

Do not introduce direct Pi, Core, streaming, or provider dependencies into UI components when a
service module can own the contract.

## Telemetry

The active provider is `HybridTelemetryProvider` in `src/services/telemetry/api-provider.ts`.

- BLE is primary through `BleTelemetryClient`.
- HTTP polling of `/api/latest` is a fallback and is skipped while BLE telemetry is fresh.
- Internal device GPS is used as a fallback when vehicle GPS is invalid or stale.
- Last successful telemetry is persisted and shown as last-known/offline state.
- App backgrounding pauses BLE and HTTP work; resume triggers an immediate poll/reconnect attempt.

The BLE command channel is token-gated for lighting and chase-session commands. The token is stored
in Capacitor Preferences by current design; revisit before wider distribution.

## Radar

Production radar is mosaic-first:

Iowa Environmental Mesonet NEXRAD N0Q composite -> Mapbox raster source -> Weather and Locate maps.

The previous Android-native single-site Level II decoder path was removed from the active app. Any
future single-site radar work should be treated as a fresh feature with explicit product approval.

## Networking

This checkout does not include the real Pi NetworkManager, hotspot, recovery AP, watchdog, or
systemd definitions. The tablet supports:

- BLE telemetry/commands to the Pi
- optional HTTP Pi endpoint by LAN hostname/IP/Tailscale address
- global Android cleartext allowance for those local/Tailscale HTTP endpoints

Future Pi networking changes should be made in the Pi-side codebase after inspecting the real
profiles and services on the Raspberry Pi.

## Mission Streaming

The Operations page includes a compact `MissionStreamingPanel` for KNWA, Code Black, recording,
and camera ingest status. The tablet is only the switch/status surface:

- status comes from `GET /api/local/stream/status` with individual `/camera`, `/knwa`,
  `/code-black`, and `/recording` fallbacks
- start/stop commands prefer BLE command transport when connected
- HTTP command fallback uses the configured Pi endpoint and existing command token
- stream states preserve the Pi vocabulary: `OFF`, `STARTING`, `LIVE`, `DEGRADED`,
  `RECONNECTING`, `FAILED`

The Pi owns actual camera ingest, FFmpeg/MediaMTX or equivalent process work, recording,
reconnect, credentials, and network failover. Code Black Core/producer/OBS/overlay workflows are
not implemented in the tablet.

## Native Android

Capacitor app id: `com.codeblackwx.ops`.

Native components:

- `TabletLocationNativePlugin`: last-known Android location bridge
- `NativeMapboxReconActivity`: hardcoded diagnostic/prototype Mapbox activity

Security-sensitive manifest settings currently include app backup enabled, global cleartext HTTP
allowed, and an exported diagnostic recon activity. Treat changes to these as policy decisions.

## Native iOS / iPadOS

The existing iOS host is `ios/App/App.xcodeproj` with Capacitor Swift Package Manager dependencies
under `ios/App/CapApp-SPM`. Bundle ID is `com.codeblackwx.ops`; deployment target is iOS 15.0.

The iOS host currently supports shared WebView UI, mosaic radar, settings/session state, and
foreground location permission preparation. Production-grade background Chase Tracking, iOS
operational notifications, idle-timer control, and CoreBluetooth field validation remain native
adapter work and must not be represented as complete until tested on Apple hardware.

## Validation

Current supported validation is build/lint/device build oriented:

```powershell
npm run lint
npm run build
npm run cap:sync:ios
npm run android:debug
```

Windows can run Capacitor iOS sync/static validation, but native iOS compilation requires macOS
with Xcode.
