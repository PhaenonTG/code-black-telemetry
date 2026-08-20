# Code Black OPS Platform Status

Code Black OPS is one shared product with thin platform adapters. The shared React/TypeScript
application owns mission state, MARK, mosaic radar, map layers, reports, settings, Chaser Net
contracts, and operational UI. Native projects should only own host behavior and platform-specific
capabilities such as background location, notifications, display control, Bluetooth, and packaging.

## Current Matrix

| Feature | Android | iPhone / iPad | Windows |
| --- | --- | --- | --- |
| Shared UI | Implemented through Capacitor WebView | Foundation through existing Capacitor iOS project | PWA/laptop preview foundation |
| Mosaic radar | Implemented with shared Mapbox GL JS raster layer | Shared WebView path, pending physical iPhone/iPad validation | Shared web path |
| MARK | Implemented in shared session/location flow | Shared flow ready; depends on available foreground location | Shared flow ready; location provider may be unavailable/external later |
| Chase sessions | Implemented in shared mission session service | Shared session logic ready | Shared session logic ready |
| Persistent background location | Implemented through Android native adapter | Pending native Core Location adapter; do not claim active | Pending desktop/external GPS adapter |
| Location permissions | Android native adapter plus shared normalized status | Info.plist has foreground location wording; background adapter/permissions deferred | Provider-specific future work |
| Notifications | Android foreground tracking notification | Pending UserNotifications/native adapter | Web/desktop notification boundary only |
| Display keep-awake | Web Wake Lock where available | Pending iOS idle-timer adapter; brightness unsupported | Web Wake Lock where available |
| BLE telemetry | Capacitor BLE boundary present | Plugin dependency present; CoreBluetooth behavior pending device validation | Future Windows Bluetooth adapter |
| Core/Pi connectivity | Configurable LAN/hostname/Tailscale endpoint with shared connection/freshness model | Local-network privacy string prepared; shared endpoint validation path | Shared HTTP client path and status model |
| Chaser Net | Shared contracts/foundation; production backend deferred | Same shared contracts; backend deferred | Same shared contracts; backend deferred |
| Native Level II radar | Deferred | Deferred | Deferred |

## iOS Project State

- Project: `ios/App/App.xcodeproj`
- Scheme: `App`
- Bundle ID: `com.codeblackwx.ops`
- Deployment target: iOS 15.0
- Dependency mode: Capacitor Swift Package Manager through `ios/App/CapApp-SPM`
- Distribution status: not App Store/TestFlight ready in this pass

The Windows development environment can generate and sync the Capacitor iOS project, but cannot
perform a native `xcodebuild` compile. Native iPhone/iPad validation still requires macOS with Xcode.

Recommended Mac validation:

```sh
npm ci
npm run cap:sync:ios
cd ios/App
xcodebuild -project App.xcodeproj -scheme App -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
```

## Capability Boundaries

Shared UI and services should ask platform-neutral questions:

- native persistent location available?
- background execution available?
- native notifications available?
- display wake control available?
- Bluetooth available?
- local network/Core endpoint configured?

Shared code must not rely on Android notification channel IDs, foreground service IDs, Android
intent names, or service lifecycle details. Those belong only inside Android native adapter files.

## Deferred Native Adapters

- iOS persistent Chase Tracking should map to Core Location background behavior with explicit user
  authorization and honest degraded states.
- iOS display keep-awake should map to `UIApplication.shared.isIdleTimerDisabled` through a narrow
  native adapter if approved.
- iOS notifications should map to UserNotifications through a native adapter before the UI claims
  operational notification support.
- Windows location should support unavailable/status-only mode first, then external GPS later.

## Core / Pi Connectivity Notes

Core and Pi states use the shared connection model documented in `docs/core-pi-connectivity.md`.
The app keeps endpoint reachability, service health, and data freshness separate so local field
network outages do not invalidate unrelated local app behavior such as Chase Mode, MARK, or mosaic
radar.

The shared client accepts explicit local/Tailscale HTTP endpoints for field infrastructure, rejects
unsafe URL schemes, and keeps iOS local-network privacy requirements visible for later device
validation. No Bonjour/mDNS discovery, production Core backend, or Pi-side network topology changes
were added in this pass.
