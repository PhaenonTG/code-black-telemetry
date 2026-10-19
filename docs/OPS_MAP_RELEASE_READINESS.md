# OPS map release readiness

Updated: 2026-09-09

## Release behavior

- Mapbox marker positioning is preserved. Code Black marker styling may add or remove only
  `atlas-*` classes; it must never replace Mapbox's `mapboxgl-marker` class.
- Nearby uses the selected live Fabric chase unit. The operator can change the reference in the
  map header. If no chase unit has a valid location, it falls back to this device's GPS.
- Nearby place data refreshes after roughly 5-7 miles of movement, on app resume, after a reference
  change, and every ten minutes. A map click changes Storm Intel selection only.
- Spotter Network positions without a parseable report time or older than eight minutes are not
  rendered. At wide regional and national zooms, dense active positions cluster; isolated active
  positions remain visible. At zoom 6 and closer, positions render individually.
- Public cameras render individually at approximately ten-county zoom and closer (zoom 6+), and
  cluster farther out. Cluster counts open into individual cameras by zooming in.
- Nearby map pins use compact category glyphs with a neutral shadow. The former glowing colored
  squares are retired.
- Telemetry is not marked live merely because Core health responds. A live vehicle sample must be
  observed before a live telemetry state is appropriate.
- Camera markers can be pinned into a nine-camera, snapshot-first wall in the right operations
  rail. Pinned cameras persist in the browser; failed media is visibly marked and can be reopened
  into the full stream viewer.
- Snapshot Mode forces the full viewer to prefer provider stills over HLS/video and persists per
  browser. The LOW DATA layer preset also disables single-site radar and camera markers.
- AHEAD filters public cameras and road hazards to four miles around the vehicle plus a 20-mile,
  110-degree forward corridor based on GPS heading.
- Operational presets provide Intercept, Travel, Flood, Night, and Low Data baselines while all
  individual layer controls remain available.
- NWS and Spotter Network storm reports remain for two hours and visibly fade after 45 minutes.
- USGS river gauges appear at zoom 5 and closer with current stage and approximately one-hour
  rise/fall rate. They do not claim flood stage because that threshold is not part of the USGS
  instantaneous-value response.
- Iowa RWIS stations augment METAR/ASOS with air temperature, dewpoint, sustained/gust wind,
  visibility, precipitation type, and road/mile-marker context.
- Single-site radar accepts up to twelve client frames, crossfades raster opacity over 650 ms, and keeps up
  to eight decoded worker frames globally for 30 minutes. Worker site eviction retains the three
  most recently used sites and removes orphaned tiles.

## Camera coverage

| State | Provider | Data path | Status |
| --- | --- | --- | --- |
| Arkansas | ARDOT IDrive | Public GeoJSON; camera media relay | Implemented; 552 cameras observed 2026-09-09 |
| Iowa | Iowa DOT 511 | Official public cameras, RWIS views, winter-route geometry, and CARS events | Implemented |
| Kansas | KDOT KanDrive | Official public camera inventory and on-demand map detail | Implemented; 601 viewport-valid cameras observed 2026-09-09 |
| Missouri | MoDOT Traveler Information | Strict same-origin relay to official ArcGIS services | Implemented and deployed |
| Nebraska | Nebraska DOT 511 | Official public camera inventory | Implemented; 349 viewport-valid cameras observed 2026-09-09 |
| Oklahoma | ODOT | WZDx work-zone and closure adapter plus strict same-origin relay | Implemented; relay prefers the Pages token and falls back to USDOT's public registry; public camera inventory remains unavailable |
| Tennessee | TDOT SmartWay | Official open-data incidents, operations, weather, severe impacts, cameras, snapshots, and HLS | Implemented |

The Missouri relay accepts only the two required services, numeric layer IDs, the `query` operation,
and a small query-parameter allowlist. It cannot be used as a general proxy.

## Acceptance before production

1. Deploy the OPS build through the normal release path.
2. At national zoom, enable Spotter Network and Cameras. Confirm clusters appear and expand as the
   map zooms in.
3. At zoom 6 or closer in Arkansas, Iowa, Kansas, Missouri, Nebraska, and Tennessee, confirm individual camera coordinates sit
   on the corresponding roadway and at least one camera detail opens per state.
4. Confirm every Spotter Network popup reports eight minutes old or newer.
5. Select each live chaser in `NEARBY FOR`, then confirm the nearest gas, lodging, food, and ER
   change to that chaser's area.
6. On a phone viewport, scroll from the map through the full inspector and back without trapped or
   clipped content.

## Deferred work

- Oklahoma road events use the strict Advanced Mode WZDx relay. It prefers the documented Pages token binding and can resolve the public feed token from USDOT's registry without tester setup.
  Oklahoma public cameras still need an official consumable feed or written provider access. The public
  site's bot-managed application is not treated as an API.
- Per-user defaults need a profile settings field in the authenticated backend. The current release
  uses the same layout for everyone and preserves each browser's saved layer choices.
- OPS single-site radar uses the deployed same-origin `/api/v1/radar` relay. Other web builds still
  require an explicit worker URL and must state when it is unavailable.
- Flood-stage categorization awaits a reliable NOAA NWPS gauge-to-threshold contract. Current USGS
  pins show observed height and trend only.
- Camera freeze detection uses a same-origin media health relay capable of comparing image bytes.
  OPS provides an allowlisted DOT-host relay that fingerprints pinned snapshots
  every minute and labels three unchanged checks as possibly frozen; unsupported providers retain
  browser load/freshness reporting.
- Mississippi and Louisiana camera adapters remain gated on stable provider contracts. Hazcams
  requires redistribution permission, Texas requires an approved API key, and Flock remains out of
  scope as restricted ALPR data.

## Operations pass 2

- The camera wall promotes its first pinned feed as the primary view, with supporting feeds in the
  remaining grid.
- VOICE is opt-in and persisted. It speaks newly observed Tornado Warnings, Flash Flood Warnings,
  and PDS alert text once per browser session.
- WHAT CHANGED NEARBY merges current warnings, road-provider updates, and recent storm reports in
  reverse chronological order. Road entries open their existing map detail panel.
- River gauge pins now merge NOAA/NWPS observed flood category and action/minor/moderate/major
  thresholds with USGS one-hour trend observations by gauge location.
- System Health records map-provider request latency, record count, cache use, last success, and
  failure reason after Roads or Cameras has been opened.
- `/api/camera-health` is not an open proxy: it accepts HTTPS image URLs only on reviewed DOT camera
  host suffixes, rejects non-image responses, caps media at 3 MB, and returns only a short SHA-256
  fingerprint plus response metadata.

## Operations pass 3

- AHEAD requests a Mapbox driving-traffic route from current GPS to the selected map point, paints
  that route, and filters road events and cameras to a ten-mile route corridor. The existing
  heading corridor remains the fallback when routing or a destination is unavailable.
- VOICE also speaks newly encountered closed-road events from the active operational corridor.
- Warning timeline entries open the warning panel, road entries open the road panel, and report
  entries move Storm Intel selection to the report coordinate.
- The camera wall promotes the first pinned camera across two columns as the primary view.
