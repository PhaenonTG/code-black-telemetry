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

- Weather, Operations, Locate, Alerts, Report, Settings, and Layers route rendering.
- Phone portrait, tablet landscape, and desktop viewports.
- MARK and ESCAPE presence on Locate only, and absence from non-map routes.
- Locate map container, map layer popover, and expanded radar portal.
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

The helper installs `android/app/build/outputs/apk/debug/app-debug.apk`, launches the app, captures
route screenshots, checks MARK/ESCAPE map-only visibility, performs a targeted Chase start/MARK/end
smoke, checks active service and active notification state, captures logcat, and writes:

```text
artifacts/rendered-control-walkthrough/s24/s24-walkthrough-summary.json
```

The Android notification acceptance source is the active notification set:

- `cmd notification list`
- `cmd notification get '0|com.codeblackwx.ops|7319|null|10150'`

Broad `dumpsys notification --noredact` output may include Samsung/Android archive records after a
notification is removed. Archive records are historical and should not be treated as active Chase
notification leaks.

The S24 helper is intended as a repeatable smoke harness. Native Chase lifecycle acceptance still
requires judgment when device lock state, permissions, USB authorization, or secure prompts interfere.

## Fixtures And Live Providers

The rendered browser suite should remain deterministic and must not depend on live DOT, camera,
NWS, Spotter Network, Chaser Net, Core, or Pi availability. Provider-backed UI should render honest
available, unavailable, stale, or deferred states from the app's existing fixture/fallback paths.

Do not add live external submissions to this suite.
