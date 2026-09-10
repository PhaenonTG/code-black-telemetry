# Adding a second weather model, and whether to retain data

Written 2026-09-10 as a follow-up investigation alongside a hardening/polish pass
on `web/overlay/public/classic-v2.html`. Two independent questions, answered
against the actual code in both repos on disk today -- this repo
(`Code Black Telemetry`, the overlay/ops/radar-relay project) and the separate
`Code Black` repo (`services/core-api`, "Core") that Storm Intel actually lives
in. No code changes accompany this doc; it's a grounded plan for later work.

## Part 1 -- How to add a second weather model

### The short answer

This is entirely a **Core-side** change (`C:\Users\glenn\Documents\Code Black\services\core-api`,
a separate repo from this one). The overlay repo needs at most one small,
optional UI addition. The seam to extend already exists and is exactly the
same shape the real HRRR provider uses today -- adding RAP, NAM, or another
NWP model means writing one more class that satisfies the same `Protocol`
HRRR already satisfies, then registering its name in one factory function.

### The provider boundary (Core, already built)

`services/core-api/src/code_black_core_api/storm_intel/providers.py:83-90`:

```python
class StormIntelProvider(Protocol):
    name: str
    def health(self) -> ProviderHealth: ...
    def sample(
        self, latitude: float, longitude: float, *, now: datetime
    ) -> ProviderSample | ProviderUnavailable: ...
```

A provider takes a point and returns one of two things:

- `ProviderSample` (`providers.py:45-64`): `provider` (name string, e.g.
  `"hrrr-nomads"`), `product` (free text, e.g. `"HRRR CONUS 2D analysis
  (t19z f00)"`), `run_time`/`valid_time`/`retrieved_at`, and `values: dict[MetricKey,
  ProviderMetricSample]` carrying only the metric keys this provider actually
  produced for this sample -- a missing key means "not supported here," never a
  fabricated zero. `unavailable_reasons` optionally explains *why* a specific
  key is missing.
- `ProviderUnavailable` (`providers.py:67-72`) when the provider can't answer
  at all right now (network failure, no data for this run, etc).

Nothing outside `normalize.py` is allowed to know a provider's native field
names (`providers.py:1-9`'s module docstring). `normalize.py` alone converts
`ProviderSample` into the public `NormalizedMetric` contract.

### The real, working example to copy: `HrrrProvider`

`services/core-api/src/code_black_core_api/storm_intel/hrrr/provider.py` is a
complete, live-verified implementation (verified against a real NOMADS run,
2026-09-04 -- see `docs/system/code-black-storm-intel.md`'s "Live smoke test
result"). Its shape is the template for a second model:

1. **Run/cycle discovery** (`hrrr/nomads_client.py`'s `discover_latest_run`) --
   HEAD requests walking backward from "now" to find the latest published
   model run, because operational lag means the nominal top-of-hour run isn't
   published immediately.
2. **Bounded, cached data retrieval** (`hrrr/cache.py`'s `HrrrSubsetCache`,
   `hrrr/nomads_client.py`'s `download_subset`) -- server-side subsetting to a
   small bounding box, atomic-write + byte/entry-bounded cache, per-key lock
   so concurrent requests for the same (run, point) coalesce into one
   download instead of racing.
3. **Decoding** (`hrrr/grib_native.py`) -- format-specific parsing into
   `GribFieldValue`s.
4. **Normalization into `ProviderSample`** (`provider.py`'s `_normalize_fields`)
   -- only emits `MetricKey`s the model's fields can support *without*
   silently approximating a different official definition (see "what NOT to
   populate" below).
5. **Registration** in the factory
   (`providers.py:107-149`'s `build_provider_from_settings`), gated by
   `SUPPORTED_PROVIDER_NAMES = ("simulation", "hrrr")` and the
   `CODE_BLACK_STORM_INTEL_PROVIDER` env var (`config.py:11,35`).

A RAP, NAM, or GFS provider would be a new sibling package
(`storm_intel/rap/`, mirroring `storm_intel/hrrr/`) implementing the same five
steps against that model's own data source (RAP and NAM are also on NOMADS;
GFS too), plus one new `if provider_name == "rap": ...` branch in
`build_provider_from_settings` and one more entry in
`SUPPORTED_PROVIDER_NAMES`. Nothing in `normalize.py`, `context.py`,
`scoring.py`, `service.py`, or the REST/WS routes needs to change -- they only
ever see the provider-agnostic `ProviderSample`/`NormalizedMetric` shapes.

### What NOT to populate, and why that discipline matters for a second model

`HrrrProvider` deliberately withholds `bulk_shear_0_6km`,
`significant_tornado_parameter`, `supercell_composite_parameter`, and
`lapse_rate_0_3km` because HRRR's 2D surface product can't produce SPC's
*official* formulation of each (see `hrrr/provider.py:1-32`'s module
docstring and `docs/system/code-black-storm-intel.md`'s "Metrics deliberately
NOT populated, and why"). This is a real design principle, not
HRRR-specific: **a second model must apply the same test independently** --
RAP or NAM may expose different native fields than HRRR (e.g. a true 0-3km
AGL profile that would unlock `lapse_rate_0_3km`, or effective-inflow-layer
SRH/shear that would unlock a real SCP), so the withheld-set is not something
to copy from HRRR verbatim. Each new provider decides its own withheld set
based on what its own native fields can honestly support under SPC's
published definitions.

### `DataClass` (OBSERVATION vs. MODEL_ANALYSIS vs. MODEL_FORECAST) needs no change

`web/overlay/src/stormIntel/dataClass.ts:25-41` classifies a metric from
`source.runTime`/`source.validTime`, never from *which* provider produced it.
A RAP or NAM value classifies exactly like an HRRR value today: `MODEL_ANALYSIS`
when `validTime ≈ runTime`, `MODEL_FORECAST` once the gap exceeds
`FORECAST_LEAD_EPSILON_MS` (1 hour, tuned to HRRR's hourly forecast-hour step,
`dataClass.ts:14-18`). RAP is also hourly, so it's unaffected. **GFS is the
one case worth re-checking**: GFS often steps at 3-6 hours at longer lead
times, so a GFS-backed forecast metric with a sub-1-hour-but-still-later
valid time is implausible in practice, but the epsilon was never tuned
against GFS specifically -- worth a quick sanity check if GFS is ever added,
not a blocking concern for RAP/NAM.

### Whether/how the overlay shows *which* model backed a value

Nothing renders `source.provider`/`source.product` today. The fields already
exist on the wire and already normalize with zero HRRR-specific logic
(`web/overlay/src/stormIntel/normalize.ts:51-78` treats `provider`/`product`
as opaque strings) -- so a RAP-backed metric would flow through the existing
pipeline and render correctly today, just without a visible "which model"
label anywhere. If a label matters (e.g. for dev/QA, or so a viewer/producer
can tell HRRR from a RAP fallback), it's a small, additive overlay-repo
change: read `metric.source?.provider` in whichever component renders
`NormalizedMetric` and add a small badge/tooltip, the same pattern already
implied by the existing freshness (`web/overlay/src/utils/freshness.ts`) and
`quality` presentation fields. No new Core contract is required for a single
provider label to reach the UI.

**What *would* need a new Core contract**: showing two models' values for the
same metric side-by-side (e.g. "HRRR 2400 J/kg · RAP 2100 J/kg" for the same
CAPE reading). `StormIntelSnapshot.metrics: NormalizedMetric[]` is one value
per `MetricKey` today, not one per `(MetricKey, provider)` pair
(`storm_intel/models.py`). Blending or exposing multiple models per key is a
real schema decision, not something implied by the current design -- decide
it deliberately if/when it's actually wanted, rather than as a side effect of
adding a second provider.

### Documented next step already on record

`docs/system/code-black-storm-intel.md`'s "Next steps toward a fuller real
provider" (item 4, in the Core repo) already names this exact idea: "RAP as a
documented fallback when HRRR's run is unavailable (RAP has coarser
resolution but a longer/more forgiving domain and cadence)." A fallback (try
HRRR, fall back to RAP only when HRRR's `sample()` returns
`ProviderUnavailable`) is a smaller, more contained version of "add a second
model" than a user-selectable or blended multi-model setup -- worth
considering as the first cut if/when this is picked up, since it reuses the
existing single-active-provider selection (`build_provider_from_settings`
returns exactly one `StormIntelProvider`) with a thin wrapper provider that
tries HRRR then RAP, rather than redesigning provider selection or the
snapshot schema.

### Summary checklist for adding model N+1

1. New package `storm_intel/<model>/` in Core, mirroring `hrrr/`'s five-step
   shape (run discovery, cached retrieval, decode, normalize-to-`ProviderSample`,
   its own honestly-withheld-metric list).
2. One new branch in `providers.py`'s `build_provider_from_settings` +
   one new name in `SUPPORTED_PROVIDER_NAMES`.
3. Sanity-check `dataClass.ts`'s `FORECAST_LEAD_EPSILON_MS` only if the new
   model's forecast-hour cadence is coarser than ~1 hour (GFS-class models;
   not RAP/NAM).
4. Optional, overlay-repo, additive: surface `source.provider`/`product` in
   whichever component renders `NormalizedMetric`, if per-value model
   attribution needs to be visible.
5. Out of scope unless explicitly decided: multi-model blending or
   side-by-side display, which needs a real `StormIntelSnapshot` schema
   change, not just a new provider.

---

## Part 2 -- Should this project retain (persist) data?

### What's ephemeral today, confirmed by reading the actual code

Every Cloudflare Worker in this repo was checked for storage bindings --
`workers/{core-gateway,radar-relay,social-gateway,usage-monitor}/wrangler.jsonc`
declare no `d1_databases`, `kv_namespaces`, or `r2_buckets`. **There is no
database, KV store, or object storage anywhere in this stack.** What looks
like caching is all in-memory and scoped to a single Worker invocation or a
single browser tab:

- `workers/radar-relay/src/index.js` uses Cloudflare's edge Cache API
  (`caches.default`) for tiles (30 min) and site/frame listings (20s) --
  purely a performance cache to stay under the free-plan request cap (see
  the incident this fixed, `[[project-cloudflare-usage-monitoring]]` in
  memory), not a durable record.
- `web/overlay/public/classic-v2.html`'s `spcCache` (a plain `Map`, 10-minute
  TTL) and its `let lastX = null` module-scope variables (GPS, weather,
  ground obs, viewer count, storm intel, forecast, SPC) -- all gone on tab
  close, by design ("leave last-known value in place" is about surviving a
  single missed poll, not about persistence).
- Core's `ChaseLocationStore`
  (`services/core-api/src/code_black_core_api/chase_location.py:56-92`,
  separate repo) holds only the single latest heartbeat per `unit_id` in a
  plain `dict`, replaced on every ingest (`ingest()`, line 61-71) -- **no
  position history at all**, not even in memory. A unit's entire GPS trail
  during a chase exists nowhere once the next heartbeat overwrites it.
- Storm Intel's own trend computation
  (`docs/system/code-black-storm-intel.md`'s Limitations: "the in-memory
  `_last_sample_by_key` cache in `StormIntelService` does not persist across
  restarts") confirms the same pattern in Core's weather-data path.

### Recommendation, by data category

**Don't persist** (cheap to re-derive elsewhere, or no retrospective value):

- **Weather/ground obs/SPC outlooks**: Open-Meteo, NWS METAR, and SPC's own
  outlook archive already are the durable record. Storing a duplicate of a
  60-second poll buys nothing an archive pull can't answer later for any
  past date, and the write volume would be pure noise.
- **Radar tiles/frames**: NOAA's own NEXRAD archive is the canonical source
  `radar-relay` already reads from. Re-hosting a duplicate in R2 is storage
  cost for zero unique value unless there's a specific need to re-serve
  exact historical tiles faster than NOAA's archive -- nothing in this repo
  currently indicates that need.
- **Viewer counts**: a live vanity metric with no operational purpose once
  the stream ends, unless cross-event stream-performance analytics become an
  actual goal (not currently indicated anywhere in this repo).

**Genuinely worth considering** (specific to this operation, not
re-derivable from a public archive):

- **GPS/position history (breadcrumbs)**: *the* strongest candidate. A
  chase's actual route, over time, has real value this repo's public data
  sources can't substitute for:
  - **Post-event route review** -- "what should we have done differently"
    needs the real path taken, not a live-only snapshot.
  - **Documentation/liability** -- storm chasing carries real legal/safety
    exposure (traffic incidents, access disputes, public-safety
    interactions); a timestamped position trail has defensive value if
    anything is ever disputed. This has privacy/legal-strategy implications
    beyond engineering, though, so it's a call for Glenn to make
    deliberately, not something to build silently as a side effect of a
    hardening pass.
  - Replay/analytics *as a product feature* is plausible but currently
    speculative -- nothing in this repo's docs expresses that as an actual
    intent yet, so treat it as a nice-to-have if breadcrumbs get built, not
    the primary justification.
- **Storm Intel snapshots at the moment of a chase**: unlike weather/SPC,
  these are tied to a specific position *and* time that a later public
  archive pull can't reconstruct exactly the same way (the position was
  chase-specific). Worth persisting only sparsely (see below), not every
  poll.

### If pursued: where, and how sparse

The stack is already 100% Cloudflare Workers with zero existing DB
infrastructure, so the natural fit:

- **D1** (SQLite-compatible, relational) for GPS breadcrumbs and storm
  reports -- structured, small, queryable by time/location. Write volume
  stays trivial even on D1's free tier if sampled (e.g. one point per
  30-60s, or reusing the "moved > ~0.01 deg" threshold `classic-v2.html`
  already computes for its own `moved` check) rather than every 5s GPS poll.
- **R2**: no clear need today (see "don't persist: radar tiles" above)
  unless that decision changes later.
- **KV**: doesn't fit any of the candidate data -- KV suits low-write,
  high-read config lookups, not time-series chase telemetry.

**Explicitly avoid over-persisting even if this is built**: don't write
every WS resend of a Storm Intel snapshot -- Core's WebSocket is a
fixed-interval resend loop, not change-driven (`docs/design/overlay-data-flow-audit.md`
part 1: "Sends one `StormIntelEvent` immediately on connect, then re-sends
the same shape every `poll_seconds`... whether or not the content changed"),
so naive persistence would store large amounts of duplicate data. Sample
sparsely (e.g. once per few minutes, or only alongside an `EventTakeover`
trigger) if this is ever built.

### Bottom line

**Don't build persistence yet.** This is a pre-Core-integration, mostly-simulated
overlay with zero real chase telemetry flowing through it today -- adding a
database now would be solving a problem before there's real usage to learn
from. When Core does go live and real chases start generating real
GPS/report data, the highest-value, lowest-effort first cut is a sparse,
D1-backed GPS-breadcrumb + storm-report log on the Core side (extending
`ChaseLocationStore.ingest()` to also append a sampled row, rather than only
overwriting `_latest`) for post-event route review and documentation.
Everything else this task asked about -- radar, weather, SPC, viewer counts
-- is either already durably archived elsewhere or has no demonstrated
retrospective value, and persisting it would be cost without a stated
purpose.
