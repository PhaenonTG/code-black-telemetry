# Rendered Control Walkthrough

This pass adds repeatable rendered-app checks for Code Black OPS route and control wiring.

## Browser Suite

Run:

```powershell
npm run test:walkthrough
```

The suite uses Playwright and starts the Vite dev server automatically. Reports, traces, and
failure screenshots are written under:

```text
artifacts/rendered-control-walkthrough/
```

The browser suite covers:

- Home, Map, Weather, Alerts, and More primary phone navigation.
- Operations, Report, Settings, and Layers as secondary destinations through More.
- Phone portrait, tablet landscape, and desktop viewports.
- MARK absence from user-facing UI, with ESCAPE present only on the Map route.
- Map container, map layer popover, and expanded radar portal.
- Home module defaults, visibility, reorder persistence, and module tap navigation.
- Layer page provider-backed and deferred-state wording.
- Settings secure credential and live overlay status wording without exposing secrets.
- Report locked-state behavior so Spotter Network submission is not triggered by navigation.
- Shared Chase UI state transitions in the browser shell.
- Meaningful console/page errors, with a narrow allowlist for known Mapbox/WebGL noise.
- Basic horizontal-overflow and zero-size container regressions.

Browser walkthrough success does not validate Android foreground services, Android notification
cleanup, native background location, locked-screen behavior, or physical-device permissions.

## S24 Helper

Run after building the debug APK and connecting the S24:

```powershell
npm run android:debug
powershell -ExecutionPolicy Bypass -File scripts\s24-rendered-walkthrough.ps1
```

Useful parameters:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\s24-rendered-walkthrough.ps1 `
  -DeviceSerial RFCWC0D36KV `
  -ApkPath android/app/build/outputs/apk/debug/app-debug.apk `
  -PackageName com.codeblackwx.ops
```

If `-DeviceSerial` is omitted, the helper uses `CODEBLACK_ANDROID_SERIAL` or auto-selects the only
authorized physical Android device. It fails clearly for unauthorized, offline, missing, or multiple
devices. The current accepted target is:

```text
Samsung Galaxy S24 / SM-S921U / RFCWC0D36KV / Android 16
```

Other Android devices should be compatible in principle, but they are not accepted by this S24
workflow until run and reviewed.

The helper installs `android/app/build/outputs/apk/debug/app-debug.apk`, verifies APK path, size,
timestamp, SHA-256 hash, package version, and version code, launches the app, waits for the WebView
and DOM shell, captures route screenshots, checks MARK UI absence and Map-only ESCAPE visibility,
validates Android Back for the map layer popover and expanded radar portal, performs a targeted
Chase start/map-usable/end smoke, checks active service and active notification state, covers
force-stop-while-active relaunch reconciliation, captures logcat, and writes:

```text
artifacts/rendered-control-walkthrough/s24/s24-walkthrough-summary.json
```

Failure bundles are written under:

```text
artifacts/rendered-control-walkthrough/s24/failures/<run-id>/
```

Each bundle includes a screenshot, UIAutomator hierarchy, recent logcat, service dump, active
notification list, and WebView state where available. Generated artifacts remain ignored from Git.

The Android notification acceptance source is the active notification set:

- `cmd notification list`

The helper identifies the Chase notification by stable active-notification fields: package
`com.codeblackwx.ops`, notification ID `7319`, and channel `codeblack_chase_tracking` where
available. It does not hardcode the app UID or full notification key.

Broad `dumpsys notification --noredact` output may include Samsung/Android archive records after a
notification is removed. Archive records are historical and should not be treated as active Chase
notification leaks.

The S24 helper is intended as a repeatable native smoke harness. It uses WebView selectors for
rendered route/control assertions and UIAutomator evidence as a fallback; it should not silently tap
unknown permission prompts or arbitrary screen coordinates. Native Chase lifecycle acceptance still
requires judgment when device lock state, USB authorization, OS overlays, or secure prompts
interfere.

Expected pass summary:

```text
S24 NATIVE WALKTHROUGH
PASS install-apk
PASS deterministic-start-state
PASS launch-and-webview-ready
...
PASS logcat-health
23/23 checks passed
0 relevant fatal logcat events
```

Browser walkthrough success does not validate Android foreground services. S24 walkthrough success
does not validate iOS Keychain runtime, Windows credential runtime, or real Pi/ESP hardware packets.

## UI Screenshot Baseline

A separate script captures a verified, labeled screenshot set for design/UX review -- it does not
replace the pass/fail walkthrough above, and it is not run as part of it. Run after building and
connecting the S24:

```powershell
npm run android:debug
powershell -ExecutionPolicy Bypass -File scripts\s24-ui-screenshot-baseline.ps1 -DeviceSerial RFCWC0D36KV
```

It captures 15 named screenshots under `artifacts/ui-review/s24-ui-foundation/` plus a
`screenshot-manifest.json` recording, per file, the route/state, the selector that was verified
before capture, a timestamp, and whether the content is live-provider or fixture-driven. Every
capture asserts its target state against the live WebView DOM (route active, a dialog/popover
present, a specific CSS class applied) before taking the screenshot -- it never uses a fixed delay
as its readiness signal, which is what let a prior ad hoc capture pass silently mislabel 6 of its
10 screenshots (e.g. two files both actually showing Settings, and four files that were all the
same Expanded Radar crop).

The camera-detail capture (`07-camera-detail.png`) is real live provider data: the script enables
the Public Cameras layer, calls a QA-only `window.__codeblackDebugJumpToCamera()` hook (added to
`AtlasMap.tsx`, not used anywhere in normal app UI) to center the map on a real, already-loaded
Arkansas DOT IDrive camera's coordinates, then clicks whichever real camera marker that jump
brought into view. The camera, its coordinates, and its image are never fabricated -- only the
choice of *which* already-live camera to center on is scripted.

Manual review still matters: after any run, open all 15 images and confirm each one actually shows
what its filename and the manifest claim before treating it as a trustworthy design review input.

## Fixtures And Live Providers

The rendered browser suite should remain deterministic and must not depend on live DOT, camera,
NWS, Spotter Network, Chaser Net, Core, or Pi availability. Provider-backed UI should render honest
available, unavailable, stale, or deferred states from the app's existing fixture/fallback paths.

Do not add live external submissions to this suite.
