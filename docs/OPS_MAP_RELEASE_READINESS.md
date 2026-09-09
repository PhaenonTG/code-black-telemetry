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

## Camera coverage

| State | Provider | Data path | Status |
| --- | --- | --- | --- |
| Arkansas | ARDOT IDrive | Public GeoJSON; camera media relay | Implemented; 552 cameras observed 2026-09-09 |
| Kansas | KDOT KanDrive | Official public camera inventory and on-demand map detail | Implemented; 601 viewport-valid cameras observed 2026-09-09 |
| Missouri | MoDOT Traveler Information | Strict same-origin relay to official ArcGIS services | Implemented and deployed |
| Nebraska | Nebraska DOT 511 | Official public camera inventory | Implemented; 349 viewport-valid cameras observed 2026-09-09 |
| Oklahoma | ODOT | WZDx road adapter staged; no deployed relay | Disabled; public camera feed unavailable to this integration |

The Missouri relay accepts only the two required services, numeric layer IDs, the `query` operation,
and a small query-parameter allowlist. It cannot be used as a general proxy.

## Acceptance before production

1. Deploy the OPS build through the normal release path.
2. At national zoom, enable Spotter Network and Cameras. Confirm clusters appear and expand as the
   map zooms in.
3. At zoom 6 or closer in Arkansas, Kansas, Missouri, and Nebraska, confirm individual camera coordinates sit
   on the corresponding roadway and at least one camera detail opens per state.
4. Confirm every Spotter Network popup reports eight minutes old or newer.
5. Select each live chaser in `NEARBY FOR`, then confirm the nearest gas, lodging, food, and ER
   change to that chaser's area.
6. On a phone viewport, scroll from the map through the full inspector and back without trapped or
   clipped content.

## Deferred work

- Oklahoma road events need the documented WZDx credential and a strict Advanced Mode relay before
  the staged adapter can be enabled. Oklahoma public cameras need an official consumable feed or written provider access. The public
  site's bot-managed application is not treated as an API.
- Per-user defaults need a profile settings field in the authenticated backend. The current release
  uses the same layout for everyone and preserves each browser's saved layer choices.
- OPS single-site radar uses the deployed same-origin `/api/v1/radar` relay. Other web builds still
  require an explicit worker URL and must state when it is unavailable.
