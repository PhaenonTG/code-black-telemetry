# Code Black OPS Website

Status: Phase 2 development workstation. Not deployed publicly.

## Architecture Decision

The OPS website lives in `web/ops`. Phase 2 continues extending that existing React/Vite package
rather than creating another frontend or backend.

The application now has one shared `CoreOpsProvider` mounted inside the authenticated shell. It owns:

- Core REST health polling
- Fabric REST bootstrap
- one Fabric WebSocket connection for the application
- reconnect with bounded backoff
- Fabric snapshot/update state
- selected map point state
- cancellable Storm Intel point requests
- LIVE_CORE versus explicit SIMULATION mode

Components consume `useCoreOps()` and do not create independent Core sockets.

## Private Core Access

CodeBlack-Core remains private and loopback-bound on Core. Local OPS development uses an SSH tunnel:

```text
ssh -N -L 127.0.0.1:18000:127.0.0.1:8000 codeblack@100.96.77.89
```

Run Vite through the same-origin proxy:

```text
VITE_OPS_DATA_MODE=LIVE_CORE
VITE_CODEBLACK_CORE_BASE_URL=/core-api
VITE_CODEBLACK_CORE_WS_URL=ws://127.0.0.1:5177/core-ws
CODEBLACK_CORE_PROXY_TARGET=http://127.0.0.1:18000
npm run dev -- --host 127.0.0.1 --port 5177
```

This avoids browser CORS changes and does not alter Core firewall, listeners, Tailscale, MQTT,
systemd, or production configuration.

## Verified Production Contracts

Verified through the tunnel on 2026-09-06:

- `GET /health`
- `GET /api/fabric/v1/health`
- `GET /api/fabric/v1/units`
- `WS /api/fabric/v1/ws`
- `GET /api/storm-intel/v1/health`
- `GET /api/storm-intel/v1/point?latitude=&longitude=`

The production Storm Intel point contract currently exposes current/latest point data. A valid-time
query parameter was not present in OpenAPI, so the OPS timeline is marked current-only/development.

## Routes

Primary navigation:

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

Legacy aliases `/map`, `/weather`, `/alerts`, and `/operations` remain during transition.

## Data Semantics

The browser consumes normalized CodeBlack-Core contracts only. It does not fetch NOAA/NCEP GRIB,
does not connect to MQTT, and does not derive a second meteorological truth.

Storm Intel rendering preserves:

- requested latitude/longitude
- resolved grid latitude/longitude
- grid distance
- provider and product
- model run and valid time
- forecast hour
- `OBSERVATION`, `MODEL_ANALYSIS`, and `MODEL_FORECAST`
- `DIRECT`, `CALCULATED`, `PROXY`, and `UNAVAILABLE`
- freshness and unavailable reasons

Unsupported metrics remain unavailable. Sounding Snapshot and Consensus stay architectural only.

## Phase 3 Storm Intel Workspace

`/storm-intel` is now a dedicated forecasting workspace rather than a duplicate LIVE OPS view. It
keeps the map as the primary surface, but adds a Storm Intel command header, point provenance,
bounded recent-point history, grouped severe-environment metrics, and disabled future workflow
actions for Sounding Snapshot and Consensus.

Metric groups are intentionally meteorological instead of a flat dashboard wall:

- INSTABILITY: SBCAPE, SBCIN, MLCAPE, MLCIN, MUCAPE, MUCIN when supplied.
- LOW-LEVEL / TORNADO ENVIRONMENT: LCL, 0-1 km SRH, 0-3 km SRH when supplied.
- SHEAR / STORM MOTION: currently 0-6 km bulk shear when supplied.
- THERMODYNAMICS: surface temperature, surface dewpoint, RH, lapse rates when supplied.
- SUPPORTED INDEX: fixed-layer STP only when Core supplies it.

The UI does not invent SCP, effective-layer fields, effective SRH, effective shear, EL, warning
classification, tornado probability, consensus score, or model weights. Each rendered metric keeps
its normalized source semantic visible: `DIRECT`, `CALCULATED`, `PROXY`, or `UNAVAILABLE`.

Point history is frontend state only. It is bounded to 12 recent points and deduplicates
near-identical coordinates before inserting the newest entry. A history row stores selected-time
metadata and enough provenance to identify the point, but selecting it reloads the coordinate
through the live point endpoint. The app does not present old cached history metrics as fresh live
data.

The current production OpenAPI for `/api/storm-intel/v1/point` accepts only:

- `latitude`
- `longitude`

It does not expose explicit `valid_time`, `forecast_hour`, model selection, run selection, or
historical point retrieval. The timeline remains a DEVELOPMENT/CURRENT ONLY affordance until Core
adds a backward-compatible contract for those fields.

Future Sounding Snapshot integration should consume a normalized Core vertical-profile endpoint
using the selected point plus model/run/valid/FH context. The browser must not decode GRIB or
fabricate a Skew-T. Future Consensus should consume an authoritative model-matrix/target-corridor
contract; a consensus percentage must not be treated as tornado probability.

## Auth Reset UX

The forgot-password flow still uses Supabase Auth and the existing `/update-password` recovery
route. The Phase 3 change is limited to client UX hardening: `resetPasswordForEmail()` errors are
now checked and displayed as safe generic failures while successful requests keep the
non-enumerating message. The UI still does not reveal whether an unauthenticated email address
exists in Supabase.

Supabase email delivery, SMTP, site URL, and allowed redirect URLs remain provider-side
configuration. The expected redirect remains:

```text
<OPS origin>/update-password
```

## Live Core Dev Tunnel

For local live development, keep Core loopback-only and use the approved tunnel:

```text
ssh -N -L 18000:127.0.0.1:8000 codeblack@100.96.77.89
```

Browser CORS blocks direct requests to `http://127.0.0.1:18000`, so Vite should proxy the app
through `/core-api` and `/core-ws` while the proxy target points at the tunnel:

```text
CODEBLACK_CORE_PROXY_TARGET=http://127.0.0.1:18000
VITE_CODEBLACK_CORE_BASE_URL=/core-api
VITE_CODEBLACK_CORE_WS_URL=ws://127.0.0.1:<vite-port>/core-ws
VITE_OPS_DATA_MODE=LIVE_CORE
```

Do not broaden Core firewall/listeners, change Tailscale, or expose Core publicly for frontend
development.

## Map Interaction

Map click/tap immediately updates:

- selected coordinate in shared app state
- selected-point marker on the map
- Point Inspector loading state

Each click starts a new Storm Intel request and clears the previous point snapshot. Slow older
responses are ignored so a stale response cannot be displayed as the newest selected point.

## Map Technology

Phase 2 still reuses `AtlasMap` from the root app, preserving Mapbox, IEM NEXRAD mosaic radar,
warning/watch geometry, unit markers, breadcrumbs, road/camera layers, Spotter Network hooks, and
viewport-bounded behavior where existing providers support it.

## Visual System

Brand Reference v1 remains authoritative: black-first, white-led information hierarchy, sparse
Signal Red `#FF2A0C`, clipped geometry, thin tactical rules, and map-first composition.

## Validation

Run from `web/ops`:

```text
npm run test
npm run typecheck
npm run lint
npm run build
```

Browser QA should use `?phase1Preview=1` only on `127.0.0.1` in dev mode. Production builds remain
behind Supabase authorization.

## Known Limitations

- The local browser needs the SSH tunnel and Vite proxy for real Core data.
- React StrictMode in dev opens and closes one preliminary WebSocket before the steady shared socket;
  production does not perform that dev-only double effect.
- Soundings require a future normalized vertical profile endpoint.
- Consensus requires future model-matrix/target-corridor contracts.
- The Vite build still bundles Mapbox heavily; code-splitting is a later performance pass.
- Headless Chromium may report WebGL unavailable during screenshot QA. That validates the existing
  renderer-fallback state but is not a substitute for a headed browser/GPU map rendering pass.
