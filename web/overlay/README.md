# Code Black WX Overlay

The livestream/OBS broadcast overlay for Code Black WX. Renders the
persistent lower-third, rotating Storm Intel cards, the animated
hodograph, and event takeovers as an OBS browser source.

This project is intentionally separate from Code Black OPS (`src/` at the
repo root, the vehicle cockpit) and Code Black Control (`web/telemetry/`,
the future remote system-management dashboard). It only consumes a
normalized Storm Intel contract and only renders broadcast graphics --
it does not own maps, radar, chase tracking, or vehicle control.

## Run

```powershell
cd "C:\Users\glenn\Documents\Code Black Telemetry\web\overlay"
npm install
npm run dev
```

Vite serves the dev preview at `http://127.0.0.1:5175`. The dev preview
renders a 1920x1080 OBS-shaped stage with a placeholder background and a
dev control panel (scenario, context, background, scale, opacity,
position, event takeover triggers) so you can watch every state without
touching code.

For a "what OBS will actually show" check, add `?dev=0&bg=transparent` to
the URL -- this hides the dev panel and switches to a transparent stage,
matching a real browser-source capture.

## Current architecture

- `src/stormIntel/types.ts` -- the UI-facing Storm Intel contract, kept
  field-for-field with Core's `services/core-api/.../storm_intel/models.py`
  schema (camelCase instead of snake_case) so a real provider is a
  drop-in.
- `src/stormIntel/scenarios.ts` -- deterministic fixture data for all 8
  simulation scenarios (metrics, score inputs, hodograph wind profile,
  public location).
- `src/stormIntel/simulator.ts` -- `StormIntelSimulator` implements the
  `StormIntelProvider` interface with realistic fake data on a 5s tick,
  plus scenario/context switching and event-takeover timing.
- `src/stormIntel/store.ts` -- exposes the active provider to React via
  `useSyncExternalStore`, exactly matching `web/telemetry`'s store
  pattern.
- `src/components/` -- `LowerThird`, `StormIntelCards`, `Hodograph`,
  `EventTakeover`, `DevControlPanel` (dev-only, stripped via `?dev=0`).
- `src/config/overlayConfig.ts` -- reads OBS-facing config
  (`scale`/`opacity`/`position`/`bg`/`dev`) from the URL query string.

A future real Core provider only needs to implement `StormIntelProvider`
(REST polling `/api/storm-intel/v1/...` plus subscribing to the
`storm_intel.updated` WebSocket event) and be swapped in at the one line
in `store.ts` that constructs `StormIntelSimulator`. No component changes.

## Simulation scenarios

`low_end`, `severe_supercell`, `high_end_tornadic`,
`strong_cap_high_instability`, `stale_data`, `partial_data`,
`provider_failure`, `unavailable_unit_location`. Switch scenarios live via
the dev panel's dropdown, or by calling `provider.setScenario(...)` from
`getOverlayProvider()`.

Every snapshot the simulator produces carries `simulation: true` at the
top level and `providerName: "simulation"`. No component ever hides that
flag -- there is no "make simulated data look live" path.

## OBS usage (once a real Core connection exists)

Add the built `dist/index.html` (or the dev server URL during
development) as a Browser Source in OBS at 1920x1080, transparent
background, `?dev=0` in the URL. Scale/opacity/position are configurable
per-instance via URL query params without a rebuild.

## Known limitations (v1)

- Simulation only -- no real Core REST/WebSocket connection yet.
- Public location (city/state), elevation, and nearby-chaser count are
  overlay-local presentation fields; Core's Storm Intel contract does not
  currently provide them.
- The hodograph's raw wind profile has no Core equivalent yet -- Core only
  exposes derived SRH/shear summaries, not a vertical wind profile.
