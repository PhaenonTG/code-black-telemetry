# Road Conditions and Public Cameras v0.1

Road Conditions and Traffic / Public Cameras are shared Code Black OPS map layers for field
situational awareness. They are not Android-native features and do not depend on CodeBlack-Core in
v0.1. The same provider contracts are intended to run in Android WebView, iPhone/iPad WebView, and a
future Windows host.

## Current Providers

### Arkansas DOT IDrive

Provider ID: `ardot-idrive`

Coverage: Arkansas statewide traveler-information data.

Road layers:

- `https://layers.idrivearkansas.com/closures_points.geojson`
- `https://layers.idrivearkansas.com/laneclosures_points.geojson`
- `https://layers.idrivearkansas.com/construction_point.geojson`

Camera layer:

- `https://layers.idrivearkansas.com/cameras.geojson`

Camera details use public IDrive camera image/feed URLs only after a camera marker detail is opened.
The app does not preload thumbnails or streams for every marker.

## Normalized Models

Road incidents normalize to `RoadConditionEvent` with:

- provider ID and provider record ID
- category, closure state, severity, title, status, and description
- point geometry and route/direction when reported
- start/end/update timestamps where reported
- freshness state
- source provenance and provider link

Traffic cameras normalize to `TrafficCamera` with:

- provider ID and provider record ID
- name, point location, road, and view direction
- operational state
- still/preview URL and stream URL when legitimately provided
- freshness state, attribution, and provenance

Provider text is stripped of HTML and length-limited before it reaches UI. Coordinates and provider
URLs are validated before rendering.

## Freshness and Cache

Freshness states:

- `fresh`: provider timestamp is recent
- `aging`: provider timestamp is older but still useful
- `stale`: old data retained visibly as stale
- `unavailable`: no useful timestamp or provider says offline

The provider registry uses bounded in-memory viewport cache entries:

- road cache TTL: 2 minutes
- camera cache TTL: 5 minutes
- stale fallback window: 30 minutes

If a provider fails and cached data is still inside the stale fallback window, OPS keeps those
markers visible as stale instead of blanking the map. If no cache is available, the affected layer
reports provider unavailable while the rest of the map remains usable.

## Viewport Query Discipline

The app selects providers by viewport coverage and only requests data when the corresponding layer
is enabled. Requests use:

- viewport filtering
- provider coverage checks
- bounded timeouts
- request deduplication
- AbortController cancellation from map viewport changes
- stale-response guards in `AtlasMap`

v0.1 intentionally does not query all states or all providers on every pan.

## Provenance and Safety

Road data uses `OFFICIAL/STATE_TRANSPORTATION` provenance.

Camera data uses `PUBLIC/TRAFFIC` provenance.

These layers remain distinct from:

- NWS warnings/radar
- Chaser Net human reports
- Chaser Net mobile mesonet observations
- Code Black probe observations

OPS does not implement ALPR, private-camera discovery, face recognition, police-location avoidance,
or surveillance-target tracking. Only public transportation camera feeds and user-authorized future
feeds belong in this layer family.

## Future Provider Expansion

The provider registry can add Oklahoma, Kansas, Missouri, and future CodeBlack-Core proxy adapters
without changing the normalized map models. If a provider requires credentials, credentials must be
kept in configuration or on Core, never committed to the client repository.

Deferred:

- nationwide provider coverage
- provider search/discovery UI
- Core-side proxy/cache deployment
- camera stream player integration inside OPS
- mobile mesonet and probe production ingestion
