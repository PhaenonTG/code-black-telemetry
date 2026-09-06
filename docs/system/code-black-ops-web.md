# Code Black OPS Website

Status: Phase 0/1 development chassis. Not deployed publicly.

## Architecture Decision

The OPS website lives in `web/ops`. Phase 0/1 extends that existing React/Vite package rather than
creating a second frontend or backend.

Reasons:
- `web/ops` already owns the authenticated OPS website shell.
- It already reuses the root `src/map/AtlasMap.tsx` map implementation instead of copying radar,
  warning, vehicle, road, camera, and breadcrumb layers.
- It already has Supabase auth, responsive shell code, and the supplied Code Black shield asset.
- `web/telemetry` remains Code Black Control, and `web/overlay` remains the livestream overlay.

## Routes

Primary navigation is designed for the approved OPS families:

- `/` - LIVE OPS
- `/radar` - RADAR
- `/storm-intel` - STORM INTEL
- `/models` - MODELS, development placeholder
- `/soundings` - SOUNDINGS, development placeholder
- `/consensus` - CONSENSUS, development placeholder
- `/targets` - TARGETS, development placeholder
- `/fleet` - FLEET
- `/stream` - STREAM, development placeholder
- `/system` - SYSTEM
- `/settings` - SETTINGS

Legacy aliases `/map`, `/weather`, `/alerts`, and `/operations` are retained locally for existing
links during this transition.

## Data Sources

The browser consumes normalized CodeBlack-Core contracts only when explicitly configured:

- `GET /health`
- `GET /api/fabric/v1/health`
- `GET /api/fabric/v1/units`
- `WS /api/fabric/v1/ws`
- `GET /api/storm-intel/v1/health`
- `GET /api/storm-intel/v1/point?latitude=&longitude=`

The browser does not fetch NOAA/NCEP GRIB data. Storm Intel display uses the existing overlay
normalization boundary so snake_case Core payloads become the shared camelCase client contract.

## Configuration

Client environment variables:

- `VITE_OPS_DATA_MODE=LIVE_CORE` or `SIMULATION`
- `VITE_CODEBLACK_CORE_BASE_URL`
- `VITE_CODEBLACK_CORE_WS_URL`
- `VITE_CODEBLACK_DEFAULT_UNIT_ID`
- `VITE_CODEBLACK_STORM_INTEL_POLL_SECONDS`

Simulation is explicit only. If Core URLs are missing, the UI shows `UNAVAILABLE`; it does not
silently substitute simulated live data.

For local visual QA only, the Vite dev server supports `?phase1Preview=1` on `127.0.0.1` while
`import.meta.env.DEV` is true. Built production deployments still require Supabase authorization.

## Map Technology

Phase 1 reuses `AtlasMap` from the root app. That preserves:

- Mapbox basemap
- IEM NEXRAD mosaic radar
- NWS warning polygons
- NWS watch polygons
- SPC mesoscale discussion geometry where available
- unit marker layer
- breadcrumbs/history layer
- road conditions
- traffic cameras
- Spotter Network / Chaser Net layer hooks
- viewport-bounded layer fetch behavior where existing providers support it

The only root map change in Phase 1 is an optional `onPointSelect` callback used by the OPS
workstation inspector.

## Interaction Contract

Map click/tap selects a coordinate and sends it to the Point Inspector. The inspector then requests
the normalized Storm Intel point endpoint when Core is configured and reachable.

Future Sounding Snapshot and Consensus entry points attach to this same selected-point state.
No Skew-T, hodograph, consensus matrix, chase target, or severity score is fabricated in Phase 1.

## Visual System

Brand Reference v1 is authoritative:

- black-first canvas
- white-led hierarchy
- Signal Red `#FF2A0C` as sparse identity accent
- Gunmetal `#171A1D`
- Utility Gray `#8D949B`
- clipped geometry
- thin tactical rules
- no glassmorphism as the primary language
- no RGB/neon/gamer treatment

## Known Limitations

- Core production is loopback-only on Core unless exposed through an approved private proxy path.
  This pass does not alter Core networking.
- Fabric WebSocket is connected only when `VITE_CODEBLACK_CORE_WS_URL` is reachable from the
  browser.
- Soundings and Consensus are route/component architecture only.
- Weather/model values shown in Storm Intel are limited to the current production Core contract.
- The top status bar and workstation currently each create their own read-only Core subscription;
  a shared app-level Core state provider is the recommended Phase 2 cleanup.

## Validation

Run from `web/ops`:

```text
npm run test
npm run typecheck
npm run lint
npm run build
```
