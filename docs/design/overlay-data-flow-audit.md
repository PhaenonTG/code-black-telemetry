# Overlay data-flow audit (pre-integration)

Written before any live-Core code changes, per the integration-readiness pass. Grounded in the
actual Core implementation at `C:\Users\glenn\Documents\Code Black\services\core-api`, not
invented endpoint shapes.

## Current path (100% simulation today)

```
StormIntelSimulator (stormIntel/simulator.ts)
  -> scenarios.ts (buildMetrics/buildHodograph/scoreFromMetrics/publicLocationFor)
  -> OverlayState (in-memory, module singleton)
  -> store.ts's useOverlayState() (useSyncExternalStore)
  -> App.tsx -> CommandRail / EventTakeover / Hodograph (via CommandRail)
```

`store.ts` constructs exactly one `StormIntelSimulator` at module load and never swaps it. Its own
comment already states the intended seam: "Swapping this line for a `RestStormIntelProvider` is
the entire migration path off simulation." That seam is real and sufficient -- Phase A confirms it,
does not need to reinvent it.

## 1. Where external/live data should enter

Two ground-truth Core surfaces exist and are already implemented server-side (not proposed):

**Storm Intel** (`code_black_core_api/storm_intel/{models,service}.py`, mounted in `app.py`):
- `GET /api/storm-intel/v1/health` -> `StormIntelHealth`
- `GET /api/storm-intel/v1/contexts/unit/{unit_id}` -> `StormIntelSnapshot` (AT_UNIT)
- `GET /api/storm-intel/v1/contexts/unit/{unit_id}/ahead?distance_miles=10|20|30` -> `StormIntelSnapshot` (AHEAD_OF_UNIT)
- `GET /api/storm-intel/v1/point?latitude=&longitude=` -> `StormIntelSnapshot` (SELECTED_TARGET)
- `WS /api/storm-intel/v1/ws?unit_id=&distance_miles=&latitude=&longitude=&poll_seconds=` -- **not
  change-driven**. Sends one `StormIntelEvent` (`event_type: "storm_intel.updated"`) immediately on
  connect, then re-sends the same shape every `poll_seconds` (default 30, range 1-300) forever,
  whether or not the content changed. Any "duplicate suppression" must happen client-side.

**Fabric** (`code_black_core_api/fabric.py`):
- `POST /api/fabric/v1/ingest`, `GET /api/fabric/v1/units`, `GET /api/fabric/v1/units/{unit_id}`,
  `GET /api/fabric/v1/devices(/{device_id})`, `GET /api/fabric/v1/health`
- `WS /api/fabric/v1/ws` -- genuinely event-driven: sends one `fabric.snapshot` on connect, then
  pushes `unit.updated` / `unit.presence_changed` / `device.updated` / `device.presence_changed`
  as they occur, plus a 1s idle tick that only emits `*.presence_changed` if a health
  recalculation (pure time decay, e.g. LIVE->STALE with no new data) actually changed something.

Real unit IDs (from `docs/system/code-black-fabric.md`, matches the Core registry): `cbwx-unit-striker`
(Spencer), `cbwx-unit-tessa` (Nick). These must never reach public-facing overlay text.

## 2. What normalization already exists

`web/overlay/src/stormIntel/types.ts` is already a deliberate 1:1 mirror of
`storm_intel/models.py` in camelCase, per its own docstring ("so a real Core provider is a
drop-in"). Comparing field-by-field against the actual Python source confirms this is accurate,
not aspirational -- `NormalizedMetric`, `MetricSource`, `MetricTrend`, `ContextLocation`,
`StormIntelContext`, `StormIntelScore`, `StormIntelSnapshot` all match Core's real Pydantic models.

**Critical gap found:** Core's wire JSON is **snake_case**, not camelCase. FastAPI's default
`response_model_by_alias=True` only renames fields that declare an explicit Pydantic `alias=`
(just `schema_name -> "schema"` here) -- every other field serializes as its own Python attribute
name (`generated_at`, `provider_name`, `unavailable_reason`, `context_type`, `run_time`,
`valid_time`, etc.), on both REST and WS. **No normalization layer exists yet.** This is the one
piece of "drop-in" that was never actually built -- `types.ts`'s docstring describes the target
shape, not a working converter.

## 3. What is currently simulator-specific

- `StormIntelSimulator` computes everything client-side on a 5s tick (`buildMetrics`,
  `buildHodograph`, `scoreFromMetrics`, `publicLocationFor`) -- none of this exists on a real
  Core connection; Core computes and sends the full snapshot already scored.
- Hardcoded `unitId: "cbwx-unit-striker"` inside the simulator (only place a real unit ID currently
  appears in the overlay codebase) -- never rendered, but it does mean the simulator itself is
  already unit-aware in shape, just not connected to Fabric.
- `publicLocationFor()` (city/state/elevation/nearby-chaser-count) is explicitly documented in
  `web/overlay/README.md` as **not part of Core's contract at all** -- Core's real
  `StormIntelSnapshot` has no city/state/elevation/chaser-count fields. This will need to keep
  being a client-side-only concern (reverse-geocode from `context.location.latitude/longitude`, or
  a static config value) even after Core integration -- it is not something to wait on Core for.
- `EventTakeover`'s `TAKEOVER_HEADLINES` table (holdMs, headline, detail per kind) is entirely
  simulator-owned. Core's schema has no `EventTakeover`/watch/warning concept at all today -- there
  is no `/api/storm-intel/v1/...` or Fabric route that emits watches/warnings. This is a real,
  documented gap (see "Known dependencies on Core" in the final report), not something this pass
  can wire up against a real endpoint.
- `HodographData`/`WindProfileLevel` (the raw vertical wind profile) has no Core equivalent either
  -- `types.ts` already documents this ("no Core equivalent yet -- Core only exposes derived
  SRH/shear summaries, not a vertical wind profile"), confirmed still true against the real
  `models.py` (no wind-profile-shaped model exists in `storm_intel/models.py`).

## 4. Visually coupled directly to mock data

Nothing in `CommandRail`/`FeaturedMetricBay`/`Hodograph`/`EventTakeover` imports from
`simulator.ts` or `scenarios.ts` directly -- every component only consumes `OverlayState`/
`StormIntelSnapshot`/`HodographData` from `types.ts`. This is the one part of the existing design
that was already done right: the seam is clean. Confirmed by grep -- zero component files
reference `scenarios.ts` or `StormIntelSimulator` by name.

## 5. What would block swapping in real Core data

- No snake_case-to-camelCase normalization/validation layer (see #2) -- a raw `fetch()` of a real
  Core response would not match `types.ts` shapes at all today.
- No REST/WS transport code exists for Storm Intel or Fabric.
- No mode selection -- `store.ts` hardcodes `new StormIntelSimulator()` with no branch.
- No `DataClass` (OBSERVATION/MODEL_ANALYSIS/MODEL_FORECAST) concept anywhere. Core's
  `MetricSource` doesn't carry this as a field either -- it must be **derived** client-side from
  `provider`/`run_time`/`valid_time` (see Part B of the integration doc). Today Core only ships an
  HRRR provider (`provider="hrrr-nomads"`, confirmed in `hrrr/provider.py`) -- a pure NWP model, so
  every real metric currently classifies as MODEL_ANALYSIS or MODEL_FORECAST, never OBSERVATION.
  That's a correct, currently-true state to encode now, not a limitation to work around.
- EventTakeover and the raw hodograph profile have no live Core source at all yet (see #3) -- these
  must keep working in simulation/fixture form indefinitely, by design, until Core grows those
  concepts.

This audit is the basis for Parts B-J below; no code changed until this section was complete.
