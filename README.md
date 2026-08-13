# Code Black OPS

Code Black OPS is the in-vehicle storm chase operations app. It is a React 19, TypeScript,
Vite, and Capacitor 8 application packaged as an Android app under `com.codeblackwx.ops`.

Tablets are the primary chase interface, with phone support for field use. The Raspberry Pi and ESP devices provide vehicle
telemetry and control services, while future Code Black Core work should remain behind service/API
boundaries instead of being wired directly into UI components.

## Current Architecture

- UI shell: seven-page landscape swipe pager in `src/App.tsx` with a bottom dock.
- Telemetry: `src/services/telemetry/api-provider.ts` is the provider boundary used by the UI.
- Primary vehicle link: BLE via `src/services/telemetry/ble-client.ts`.
- Fallback vehicle link: configurable HTTP Pi endpoint through Settings / Pi Endpoint.
- Radar: wide-area NEXRAD mosaic through Mapbox raster tiles.
- Map: Mapbox GL JS `AtlasMap` components with mosaic radar, alerts, watches, team, chaser, POI, and breadcrumb layers.
- Native Android: Capacitor app plus Java plugins under `android/app/src/main/java/com/codeblackwx/ops`.

The real Raspberry Pi backend is not included in this checkout. Project notes identify it as a
separate Pi-side codebase at `~/CodeBlack` with Flask, BLE bridge, ESP bridge, lighting control,
and systemd services.

## Common Commands

```powershell
npm run dev
npm run lint
npm run build
npm run cap:sync
npm run android:debug
```

`install-codeblack-ops.ps1` runs lint, build, Capacitor sync, Android debug build, and `adb install -r`.

## Environment

Copy `.env.example` values into a local `.env.local` and fill only the values needed for the current
target. `.env.local` is intentionally ignored by git.

Important variables:

- `VITE_MAPBOX_ACCESS_TOKEN`: public Mapbox `pk.*` token for Atlas map rendering.
- `VITE_ATLAS_MAPBOX_STYLE`: optional Mapbox style, defaults to `mapbox/navigation-night-v1`.
- `VITE_PI_API_BASE`: optional HTTP fallback Pi API base.
- `VITE_ALLOW_SIMULATOR`: development-only simulator fallback flag.

## Documentation

- `PROJECT_STATE.md`: long-form project handoff and historical implementation notes.
- `ARCHITECTURE.md`: current code structure and dependency boundaries.
- `docs/on-device-radar-architecture.md`: retired native radar notes and mosaic-first radar status.
- `docs/2026-08-06-audit-handoff.md`: latest audit findings, TODOs, streaming readiness, and networking review.
- `CHANGELOG.md`: newest-first change history.

## Guardrails

Do not make major UI, networking, streaming, schema, or architecture changes without owner approval.
Use the existing service boundaries and document proposed changes before implementing them.
