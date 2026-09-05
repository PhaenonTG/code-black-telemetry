# Overlay live-data integration (Storm Intel)

Status: DEVELOPMENT. Implements the integration-readiness pass. See
`docs/design/overlay-data-flow-audit.md` for the pre-work audit this is built on -- read that
first for *why* each decision below was made, grounded in the real Core implementation at
`C:\Users\glenn\Documents\Code Black\services\core-api`, not invented endpoint shapes.

## Architecture

```
REST bootstrap ---\
                    +--> normalize.ts (snake_case wire JSON -> camelCase contract) --> OverlayState --> components
WebSocket push ----/
```

Three interchangeable providers implement the same `StormIntelProvider` interface
(`stormIntel/types.ts`), so `store.ts` picks one and every visual component (`CommandRail`,
`FeaturedMetricBay`, `Hodograph`, `EventTakeover`) stays identical regardless of which is active:

- `StormIntelSimulator` (`stormIntel/simulator.ts`) -- unchanged behavior, still computes its own
  fake data client-side.
- `RestStormIntelProvider` (`stormIntel/liveProvider.ts`) -- new. REST bootstrap for first paint,
  then a `StormIntelSocket` (`stormIntel/wsClient.ts`) for ongoing push.
- `FixtureStormIntelProvider` (`stormIntel/fixtureProvider.ts`) -- new. Replays a recorded,
  already-normalized frame sequence (`stormIntel/fixtures/index.ts`) with zero network calls.

Components never talk to a transport directly -- there is exactly one seam
(`store.ts::createProvider()`), matching the "real Core -> normalized adapter -> overlay store ->
visual components" shape this pass required, not "components directly fetching random endpoints."

## Mode selection

Explicit only, read once at module load from the URL query string (`config/liveConfig.ts`):

```
?mode=simulation   (default)
?mode=fixture&fixture=<name>
?mode=live_core&coreBaseUrl=...&coreWsUrl=...&unitId=...
```

Nothing ever silently upgrades or downgrades between modes at runtime -- confirmed by test
(`store.test.ts`: "never silently upgrades a plain page load to LIVE_CORE"). A page load with no
`?mode=` is always SIMULATION.

Dev-only mode indicator: `DevControlPanel` shows `MODE: SIMULATION|FIXTURE|LIVE_CORE`, distinct
from a snapshot's own `simulation` flag (Core may run its own simulation provider even over a
LIVE_CORE transport -- these are orthogonal). This indicator only exists inside `DevControlPanel`,
which is never rendered when `?dev=0` -- so it is structurally impossible for it to reach the
production broadcast output.

## Configuration surface (`config/liveConfig.ts`)

| Param | Purpose |
|---|---|
| `mode` | `simulation` \| `fixture` \| `live_core` |
| `coreBaseUrl` / `coreWsUrl` | Core REST/WS origins, no trailing slash |
| `context` | `AT_UNIT` \| `AHEAD_OF_UNIT` \| `SELECTED_TARGET` |
| `unitId` | e.g. `cbwx-unit-striker` -- internal only, never rendered (see Public identity) |
| `aheadDistanceMiles`, `latitude`, `longitude` | context-specific |
| `publicIdentity` | configured human display name |
| `fixture` | recorded sequence name for FIXTURE mode |
| `reconnectMinMs` / `reconnectMaxMs` | WS backoff bounds |
| `pollSeconds` | passed straight through as Core's `poll_seconds` WS param |

No secrets live here or anywhere in this doc -- Core's real REST/WS routes are unauthenticated in
their current implementation (confirmed by reading `app.py`; auth is explicitly deferred per
`docs/system/code-black-fabric.md`'s Phase 2 status).

## Normalized overlay contract (`stormIntel/types.ts`)

Already existed as a 1:1 camelCase mirror of Core's real `storm_intel/models.py` before this pass
(confirmed field-by-field against the actual Python source). This pass added:

- `DataClass = "OBSERVATION" | "MODEL_ANALYSIS" | "MODEL_FORECAST"` on every `NormalizedMetric`.
  Core's schema has no such field -- it is *derived* client-side (`stormIntel/dataClass.ts`) from
  `source.provider`/`runTime`/`validTime`. Today Core ships only `hrrr-nomads` (confirmed in
  `hrrr/provider.py`), a pure NWP model, so real metrics always classify as MODEL_ANALYSIS or
  MODEL_FORECAST, never OBSERVATION -- that case is reserved for a future observation-network
  provider and is never defaulted into.
- `PresenceState`/`UnitIdentity` -- minimal Fabric-facing types for future context resolution.
- `OverlayMode`.

## REST/WS flow

Real Core routes only (`code_black_core_api/app.py`), never invented:

- `GET /api/storm-intel/v1/contexts/unit/{unit_id}` (AT_UNIT)
- `GET /api/storm-intel/v1/contexts/unit/{unit_id}/ahead?distance_miles=10|20|30` (AHEAD_OF_UNIT)
- `GET /api/storm-intel/v1/point?latitude=&longitude=` (SELECTED_TARGET)
- `WS /api/storm-intel/v1/ws?unit_id=&distance_miles=&latitude=&longitude=&poll_seconds=`

**Important, confirmed by reading the real server code, not assumed:** this WebSocket is a
fixed-interval resend loop, not change-driven -- it sends one `storm_intel.updated` event
immediately on connect, then the same shape every `poll_seconds` (1-300, default 30) forever,
whether or not content changed. `StormIntelSocket` suppresses byte-identical resends client-side
(`wsClient.test.ts`) so components don't re-render on a no-op resend.

The wire format is **snake_case** (`generated_at`, `provider_name`, etc.) on both REST and WS --
FastAPI's default alias-based serialization only renames the one field with an explicit Pydantic
`alias` (`schema_name -> "schema"`). `stormIntel/normalize.ts` is the one place this conversion
happens; it throws `StormIntelNormalizationError` on missing/malformed required fields and
silently ignores unknown ones (forward-compatible).

## Failure/staleness behavior

`RestStormIntelProvider` never freezes a stale-looking "current" badge indefinitely:

- REST bootstrap failure -> explicit unavailable placeholder (`available: false`, a real
  `unavailableReason`), REST and WS attempts are independent (a WS success can still recover the
  overlay even if the initial REST call failed, and vice versa).
- `StormIntelSocket` reconnects with bounded exponential backoff (`reconnectMinMs` ->
  `reconnectMaxMs`, doubling).
- Stale-connection watchdog: if no message arrives for ~2.5x `poll_seconds`, the connection is
  treated as dead and force-reconnected even without a browser `close`/`error` event (a TCP
  connection can go silent through some proxies without ever firing either).
- Any status of `stale` or `closed` immediately overrides the visible snapshot to an explicit
  "Live Core connection lost. Reconnecting..." unavailable state -- the last-known metrics are
  never left on screen looking current once the connection itself is known dead.
- Malformed/unexpected WebSocket messages are dropped individually; the connection stays open and
  the last good snapshot remains visible.
- This does **not** duplicate Core's own model-valid-time freshness classification (current/
  aging/stale, driven by `valid_time`) -- that stays authoritative whenever data is flowing. The
  watchdog is a distinct, additional concept: "is the connection to Core itself alive," consistent
  with Fabric's own separate `PresenceState` design, not a second freshness engine.

## Fixture/replay workflow

`stormIntel/fixtures/index.ts` ships six recorded sequences (`FIXTURES` map): `normal`,
`tornadic`, `stale_transition`, `provider_failure`, `warning_takeover`, `reconnect_sequence`.
Each is a fully normalized, already-camelCase `OverlayState` sequence -- no live Core connection
or network access is used to replay them (`fixtureProvider.test.ts`: "makes no network calls").

No real Core traffic has been captured yet (none is running), so these are hand-authored using the
same builders `StormIntelSimulator` uses, then frozen and marked `simulation: false` (representing
"what a recorded real payload would look like"), distinct from the simulator's own live
`simulation: true` generation. Once a real Core connection exists, the natural extension is
dumping actual normalized WS payloads to JSON and loading them the same way -- no code change
needed on the replay side, only new fixture files.

Run with `?mode=fixture&fixture=reconnect_sequence` (etc.).

## Vertical-profile (hodograph) contract

Core's Storm Intel schema has no raw wind-profile endpoint today (confirmed against the real
`storm_intel/models.py` -- it exposes derived SRH/shear summaries as metrics, never a vertical
profile array). `RestStormIntelProvider` always reports the hodograph as unavailable
(`levels: []`, `freshness: "unavailable"`) rather than partially wiring the SRH/shear numbers that
*do* exist through a component built for a full profile-or-nothing render. `HodographData`
(`types.ts`) is the adapter boundary a future Core profile endpoint would populate; no second
weather-fetch path was created. The simulated hodograph is unchanged and still used in SIMULATION/
FIXTURE modes.

## Production requirements / what's still missing before LIVE_CORE can ship

- No auth on Core's real routes yet (Fabric Phase 2 status, `docs/system/code-black-fabric.md`) --
  production auth is explicitly still deferred there, not something this pass could add.
- No reverse-geocoding: `publicLocationFor()` (city/state/elevation/nearby-chaser-count) has no
  Core equivalent and stays `null` in LIVE_CORE mode today (confirmed in the audit) -- a real
  implementation needs either a geocoding call or a static per-context config value, out of scope
  for this pass.
- EventTakeover has no live Core source at all (no watch/warning endpoint exists yet) -- stays a
  manually/dev-triggered concern in every mode via the shared `TakeoverController`
  (`stormIntel/takeoverController.ts`), including LIVE_CORE.
- **"Core Phase 5"**, as named in the task that requested this document, does not correspond to
  any phase actually documented in this repo or in the real `services/core-api` source. The only
  real, confirmed phase markers are Fabric Phase 1 (client-side model, implemented) and Fabric
  Phase 2 (Core service implemented in code, explicitly "not yet deployed to live Core hardware";
  physical STRIKER Pi validation, TESSA direct-ESP validation, production auth, and TLS/MQTT
  broker setup remain blocked/deferred per that doc). This overlay's LIVE_CORE mode depends on
  Fabric/Storm Intel Phase 2 actually being deployed and reachable, not a "Phase 5."

## Not in scope for this pass

- No live Core connection was available or required to complete this work (verified entirely with
  mocked `fetch`/`WebSocket` in tests).
- No visual chassis change -- `CommandRail`/`BrandBug`/`EventTakeover`/`FeaturedMetricBay`/docked
  `Hodograph` are untouched.
- Watch/MD semantic colors remain provisional (`docs/design/overlay-semantic-colors-v1.md`),
  unaffected by this pass.
