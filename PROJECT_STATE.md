# Code Black OPS — Project State

Last updated: 2026-08-02. Written so a fresh AI assistant (or a human) can pick this project up
cold, with no prior conversation history, and know exactly what exists, why, and what's next.

## What this is

A storm-chase vehicle dashboard app for a team called "Code Black." Built with React 19 +
TypeScript + Capacitor 8, packaged as a native Android app (`com.codeblackwx.ops`), running on a
mounted Samsung Galaxy Tab (tested via adb serial `R5GL53J3Y4J`). Designed to be glanced at while
driving during a storm chase: current conditions, radar, alerts, GPS, nearby amenities, nearby
spotters ("chasers"), and vehicle sensor telemetry from an onboard Raspberry Pi + ESP32 sensor
network.

The owner (Glenn) drives the primary vehicle, which has 3 ESP32s feeding a Raspberry Pi (the
"vehicle" data source everywhere in this codebase). A chase partner, Nick, will run a second
vehicle with **no Pi** — just a single ESP32 (GPS + temp/humidity + anemometer) feeding an iPad
directly. iOS support and that direct-ESP32 path are future work, not yet built (see Pending).

## Tech stack

- React 19 + TypeScript, Vite 8 build (`npm run build` = `tsc -b && vite build`)
- Capacitor 8 wraps the web build as a native Android app
- Mapbox GL JS for the map; NEXRAD Level II/III decoded on-device for radar overlay
  (`nexrad-level-2-data`, `nexrad-level-3-data` packages)
- Zustand used somewhere in telemetry state (check `services/telemetry` if touching that)
- No test framework in this repo (no `test` script, no vitest/jest). Verification is
  build-clean + on-device screenshot/interaction checks — see "Dev workflow" below.
- Styling is one large `src/index.css` (5600+ lines) plus a few standalone `*.css` files
  (`TopBar.css`, `WindCard.css`) for components that were deliberately pulled out of the
  monolith. See "CSS conventions" below — this file has unusual archaeology.

## Directory map (src/)

```
App.tsx                        — root: 5-page swipeable pager, dock nav, cockpit mode state
components/
  layout/TopBar.tsx (+.css)    — header: brand, clock, date, Pi Link chip, battery chip
  situational/
    Panel.tsx                  — shared <Panel>/<MetricTile> primitives used everywhere
    Panels.tsx                 — LocationMotionPanel, WeatherObservationPanel, AlertsPanel,
                                  AlertsFullPanel, MapRadarPanel (thin wrapper -> AtlasMap)
    WindCard.tsx                — wind card (extracted from Panels.tsx)
    NearbyPanel.tsx             — amenities + Spotter Network "Chasers" card, both detail modals
  cards/                        — Operations-page cards: Power, System, SensorHealth, Events
  operations/                   — PiEndpointPanel (configure Pi IP), RadarEndpointPanel (diag)
  settings/SettingsPage.tsx     — Display/Alerts/Pi Connection/Spotter Network/About
  ui/                            — SourceBadge, StatusBadge, DashCard, MetricRow
  ErrorBoundary.tsx
hooks/                          — one hook per data source (useTelemetry, useNearbyPlaces,
                                   useSpotters, useTabletLocation, useSituationalData,
                                   useAlertProducts, useBattery)
services/
  telemetry/                    — the Pi data pipeline: types.ts, api-provider.ts (polls Pi,
                                   normalizes payload, last-known fallback), simulator.ts (dev
                                   fake data), quality.ts (freshness/age/alias-parsing helpers),
                                   fallback.ts (merges vehicle vs NWS station data)
  situational.ts                — NWS alerts + nearest station observation (ExternalObservation)
  nearby.ts                     — Overpass API amenities (gas/hospital/lodging/food)
  spotters.ts                   — Spotter Network GRLevelX feed parser (anonymous, read-only)
  spotterAccount.ts             — Spotter Network login + local credential storage (new)
  location.ts                   — canonical GPS resolution (tablet GPS vs Pi GPS), speed floor
  settings.ts                   — Pi endpoint URL persistence
  sound.ts                      — audible alert tone playback
  mapTiles.ts                    — Mapbox style/token helpers (Legacy map engine was deleted)
  radar.ts, radarLoop.ts         — NEXRAD fetch/decode
map/                             — Mapbox GL wrapper: AtlasMap.tsx (main component),
                                   AtlasCameraController, AtlasRadarLayer, AtlasVehicleLayer,
                                   AtlasRangeRingLayer, AtlasStyleManager, AtlasReconGlPage
                                   (full-screen expanded radar view)
```

## The 5 pages (App.tsx pager)

1. **Weather** (`/`, default) — 2x3 grid: Location & Motion, Conditions (WeatherObservationPanel),
   Wind, Active Alerts (compact), Situational Map, Nearby (amenities + Chasers).
2. **Operations** (`/operations`) — diagnostics-heavy: mode summary, Sensor Health, System, Power,
   Radar Engine panel, Pi Endpoint config, Events log, raw diagnostics grid.
3. **Locate** (`/locate`) — full-page map (same `MapRadarPanel`/`AtlasMap` as Weather page, second
   instance).
4. **Alerts** (`/alerts`) — `AlertsFullPanel`: uncapped product list + Storm Threat summary cards
   (watch/MD/warning) — these two were merged into one component this session.
5. **Settings** (`/settings`) — Display (cockpit mode toggle), Alerts (sound on/off + test),
   Pi Connection (opens the Operations panel), Spotter Network (sign in/out — new), About.

Cockpit mode is global (`normal` | `chase`), persisted via Capacitor Preferences, toggled from
Settings. Chase mode shows a reduced field set for glancing while driving; Normal shows full
detail. Both modes must show every field they display — never hide a field on null, always fall
back to "--" (this was a deliberate fix this session, see Recent Work).

## Data sources & how they combine

- **Vehicle (Pi)**: polled via `services/telemetry/api-provider.ts`. URL configured in Settings ->
  Pi Connection -> Open (or `PiEndpointPanel` on Operations page directly). When unreachable, the
  app retains **last-known values** (not a hard reset) for up to 5 minutes (`freshness()` OFFLINE
  cutoff in `quality.ts`), then falls through to external sources.
- **NWS station fallback**: `services/situational.ts` finds the nearest `api.weather.gov` station
  and its latest observation. Used for Conditions/Wind when the Pi is untrustworthy (offline or
  last-known >5min old). **Not every field is guaranteed** — small AWOS stations may report temp
  and wind but not dewpoint/humidity (confirmed live on KROG, Rogers AR — this is a real station
  data gap, not an app bug, and the UI correctly shows "--" for it).
- **Tablet GPS**: `hooks/useTabletLocation.ts` (Capacitor Geolocation). Speed has a **1.5 mph noise
  floor** applied in `services/location.ts` (`GPS_SPEED_NOISE_FLOOR_MPH`) — stationary GPS jitters
  0.1-0.8 mph from drift alone; anything under 1.5 displays as a clean 0.
- **Overpass API** (`services/nearby.ts`): free OSM amenity lookup (gas/hospital/lodging/food),
  no auth, no key.
- **Spotter Network**: two integrations now exist —
  - `services/spotters.ts` — anonymous, no-auth, read-only GRLevelX text feed
    (`spotternetwork.org/feeds/gr.txt`), reverse-engineered by inspecting real fetched data (their
    site blocks WebFetch/scraper tools with bot detection, but a real on-device `fetch()` works
    fine — don't conclude "blocked" from a dev-tool 403 alone). This is what currently powers the
    "Chasers" row on the Nearby card. Marked "NON-COMMERCIAL USE ONLY" by Spotter Network — fine
    for personal/team use, would need their explicit sign-off before any commercial distribution.
  - `services/spotterAccount.ts` — **official JSON API**, documented at
    https://spotternetwork.docs.apiary.io (this doc site is hosted on old Apiary infra and
    intermittently 502s — just retry navigation, it comes back). Full endpoint list:
    - `POST /login` `{username,password}` -> `{id, marker, CanReport}` — the `id` is the
      "Application ID" / session credential for all other calls.
    - `POST /positions/update` — broadcast your own position (not used yet).
    - `POST /positions` `{id}` — clean JSON spotter list (first/last/email/phone/ham/twitter/web)
      — could replace the GRLevelX scrape entirely, not yet wired in.
    - `POST /report/severe` — **submit a severe weather report** (tornado/hail/wind/flood flags,
      narrative, lat/lon, optional NWSChat/Twitter broadcast). This is the feature the owner
      emailed Spotter Network's developer (ryan@spotternetwork.org) about and wants built next —
      **not yet implemented**, only the sign-in plumbing exists so far.
    - `POST /reports` `{id}` — recent team/community reports feed.
    - Currently wired: Settings -> Spotter Network -> username/password sign-in, calls `/login`,
      stores the account (**including the plaintext password**) in Capacitor Preferences
      (unencrypted on-device storage). **This was an explicit, scoped decision** — the owner said
      "we can store passwords locally for now as this isn't a public app... revisit if we go
      public." If this app is ever distributed beyond the team, switch to not storing the
      password (re-prompt instead) or get a dedicated non-personal app credential from Spotter
      Network.

## Established conventions (follow these, don't relitigate them)

- **CSS**: `src/index.css` is a single file with real archaeology — the same selector (e.g.
  `.map-controls`) appears multiple times across different "sprint" sections of the file, because
  earlier passes were layered on rather than edited in place. **The last matching rule in file
  order wins** (same specificity). When changing existing visual behavior, grep for every
  occurrence of the selector first, find the one that's actually winning, and either edit that one
  or append a new override near the true end of the file (`!important` if needed to be safe against
  earlier rules). Don't assume the first occurrence you find is the active one.
- **Never hide a field on null** — show a value or a clean "--" placeholder. This was explicitly
  fixed this session (Conditions/Wind tiles used to `{value != null && <Tile/>}` and vanish in
  chase mode; now always render).
- **Credential handling**: the owner has twice pasted real secrets into chat unprompted (an
  account password, and a screenshot of an "Application ID" the source site explicitly marks
  never-to-share). Standing rule: don't use credentials pasted into chat directly (e.g. to
  hardcode into source) — decline, explain why, prefer a public/read-only path if one exists, or
  build a real in-app credential flow instead (which is what happened with the Settings sign-in).
  This is different from a user explicitly directing you to build a credential-storage *feature*
  (which they did, and which is fine, and is now built).
- **Device verification workflow**: no test suite exists. To verify a change:
  ```
  npm run build                        # tsc -b && vite build — typecheck + bundle
  npx cap sync android                 # copies dist/ into the Android project
  cd android && ./gradlew.bat assembleDebug
  adb -s R5GL53J3Y4J install -r android/app/build/outputs/apk/debug/app-debug.apk
  adb -s R5GL53J3Y4J shell am force-stop com.codeblackwx.ops
  adb -s R5GL53J3Y4J shell monkey -p com.codeblackwx.ops -c android.intent.category.LAUNCHER 1
  adb -s R5GL53J3Y4J exec-out screencap -p > screenshot.png
  ```
  Then actually look at the screenshot (crop/zoom with PIL for pixel-level checks — this project's
  established practice, not eyeballing a thumbnail). `adb logcat` for JS console output has a
  **ring-buffer gotcha**: this app's telemetry/radar polling logs at high frequency, so a one-time
  startup diagnostic can be pushed out of the buffer within seconds. Pattern: `adb logcat -c`
  (clear) -> force-stop + relaunch -> grab logs within ~1-2 seconds, not after a long sleep.
- **Tablet connectivity flakiness**: the adb connection to the tablet occasionally drops on its
  own ("device not found" even after `adb kill-server && adb start-server`). Don't burn more than
  ~2 retries silently — ask the user to check the physical connection/cable.
- **Don't scope-creep bug fixes** — the owner wants tight, single-purpose diffs. A visual fix
  shouldn't turn into a refactor of surrounding code.

## Recent work (most recent session, chronological)

1. Deleted the old "Legacy" Canvas-based map renderer and its engine-switch UI entirely — Atlas
   (Mapbox GL) is now the only map engine. Removed ~410 lines of dead code + orphaned helpers.
2. Merged `StormThreatsPanel` into `AlertsFullPanel` on the Alerts page (was two components, one
   redundant).
3. Conditions card sizing pass — removed a stale "PARTIAL WEATHER DATA" toolbar badge, fixed a
   real overflow bug where pressure like "29.94▲" clipped at larger font sizes (now shows 1
   decimal).
4. Built the **Spotter Network "Chasers" feature**: nearby-spotter count + 3 closest by name on
   the Nearby card, tap to see full list, tap a spotter for full detail (name/phone/socials/map
   links). Backed by the anonymous GRLevelX feed (see Data Sources above). Universal `https://`
   map links (not `geo:`/`waze://` schemes) chosen specifically for future iOS portability —
   offers Apple Maps (iOS only, `Capacitor.getPlatform() === "ios"`), Google Maps, Waze, plus Copy
   Address/Coordinates.
5. Got the **official Spotter Network API docs** from their developer (Ryan) —
   https://spotternetwork.docs.apiary.io — full endpoint list captured above. Owner's stated goal:
   submit severe weather reports from inside the app, for the Code Black team (not just personal
   use), for now kept private (would need to discuss report-limits with Ryan before going public).
6. **Visual audit pass #1** (Weather page, chase mode) found and fixed two device-verified bugs:
   - Map zoom-in ("+") button was completely hidden behind the radar status chip whenever it grew
     to its 3-line "LOADING" state — both used the same `top:12px;left:12px` anchor. Fixed by
     moving `.atlas-map-controls` to `bottom:12px;left:12px` instead (index.css, near end of
     file).
   - GPS metric tile text wrapped to 3 lines and duplicated the Fix/Accuracy already shown in the
     card footer — dropped the redundant "FIX " prefix from the unit string
     (`Panels.tsx`, `LocationMotionPanel`).
7. Built the **Spotter Network sign-in** in Settings (`services/spotterAccount.ts` +
   `SettingsPage.tsx`): username/password form, calls `/login`, stores account + password in
   Preferences, shows signed-in state with a Sign Out option. Verified end-to-end against the
   live API (deliberately wrong test credentials -> got a real 401 and the correct error message
   rendered). Report submission and switching the positions feed to the official JSON endpoint are
   **not yet built** — only the auth plumbing.
   - Hit and fixed a real layout bug during this: the new Sign In panel's content (2 inputs +
     button) overflowed its fixed-height Settings grid cell and the button was clipped by
     `overflow:hidden` on `.cb-panel`. Fixed by tightening row padding/gaps and shortening the
     helper text, not by restructuring the grid.
8. Added a **battery indicator** to the header: small icon + percentage, color-coded (green >65%,
   amber 35-64%, red <35%). Required adding `@capacitor/device` as a new dependency
   (`Device.getBatteryInfo()`, polled every 30s via `hooks/useBattery.ts`). Placed after the Pi
   Link chip in the top-right corner per explicit request (was briefly placed before it, then
   swapped).
9. Added a **GPS speed noise floor** (1.5 mph) in `services/location.ts` — stationary tablet was
   showing 0.1-0.8 mph from GPS drift; anything under the floor now displays as a clean 0.0.
10. Diagnosed (not a bug): Conditions card showing "--" for Dewpoint/Spread/RH — confirmed live
    against `api.weather.gov/stations/KROG/observations/latest` that the station itself reports
    null for dewpoint and relativeHumidity (smaller AWOS station, no hygrometer). App is behaving
    correctly per the "never hide, show --" rule.
11. **Full OCD audit pass #2** (Operations/Locate/Alerts/Normal mode) found and fixed 4 more
    confirmed bugs: Radar Engine panel's ~30 diagnostic rows + Apply/Clear Cache buttons were
    clipped by `overflow:hidden` (fixed with `overflow-y:auto` scoped to `.radar-endpoint-panel`);
    4 Operations panel titles were missing the shared red-diamond glyph because they hand-roll
    `<div className="cb-panel__title">` instead of using `<Panel>` (fixed with a `::before`
    pseudo-element matching `.panel-glyph`'s exact styling, scoped to those 4 classes); the Nearby
    card's `.nearby-card` grid (`minmax(0,1fr) auto`) let a long closest-chaser name in column 2
    starve column 1's count text into truncating (fixed with a floor on column 1 and a max-width
    ellipsis on column 2's `em`); Alerts page empty state had ~400px of dead space below the
    message because `.alert-list--full` is `align-content:start` (fixed by centering it with
    `:not(:has(.alert-pill))`).
12. **Typography consistency pass**: header clock digits were weight 700 while every sibling chip
    (date/Pi-Link/battery) was 800 — now matches. "LOCAL TIME" caption was a hardcoded `10px` while
    everything around it used `clamp()` — now responsive. `.nearby-card strong` (amenity/chaser
    names) used "Arial Narrow"/"Segoe UI", an orphaned one-off not used anywhere else in the app —
    switched to Inter to match `.spotter-row strong`'s identical role elsewhere. `.loc-city`
    (the city name) had ~10 conflicting rules across the file's history gated behind different
    device-width media queries, some allowing wrap and some truncating — locked down to a single
    guaranteed `white-space:nowrap; overflow:hidden; text-overflow:ellipsis` rule at true end of
    file so a very long city name always truncates cleanly regardless of viewport.
13. **Removed blue from the palette** per explicit request — red/white/black + amber for
    severe-warning use only. Redefined `--blue`/`--cb-blue` custom properties to resolve to
    `--cb-text` (near-white) at the true end of `index.css`, which recolors every `var(--blue)`
    usage at once (MetricTile `accent="blue"` on Dew/RH/Pressure tiles, `.threat-card--md`'s text
    color, `.nearby-card span`'s fallback). Hardcoded blue rgba literals (not going through the
    variable) were edited directly: `.threat-card--md`, `.nearby-card`, `.spotter-row`, and
    `.cb-panel--spc` (the Nearby panel's border tone) all switched from blue-tinted to white-tinted
    borders/backgrounds.
14. **Configurable Spotter Network search radius** — first of what should become a standing pattern
    per the owner ("any configurable stuff... build into settings moving forward"). Added
    `chaserRadiusMiles` get/save/subscribe to `services/settings.ts` (same shape as the existing
    `piEndpoint` functions), clamped 5-500 miles, persisted via Preferences. `NearbyPanel.tsx`
    reads it instead of a hardcoded `CHASER_RADIUS_MILES = 100` constant. New "Nearby Chasers"
    panel in Settings with a number input + Save button. Verified end-to-end on-device: saving
    persists, an out-of-range value (5000) correctly clamps to 500 on save.

All of the above were built, `npm run build` typechecked clean, synced/compiled/installed to the
physical tablet, and screenshot-verified on-device before being considered done.

## Open discussion threads (not yet built, owner said "just thoughts" / asked for a recommendation)

- **Map overlays**: owner wants warning polygons, SPC Mesoscale Discussion polygons, and Spotter
  Network position pins on the map (`AtlasMap.tsx`), each independently toggleable so the map
  doesn't get cluttered. Recommended approach (not yet built): warning polygons are nearly free —
  `api.weather.gov/alerts/active` (already polled for the Alerts page) carries a GeoJSON `geometry`
  per feature that's currently discarded; spotter pins reuse existing position data; MD polygons
  need a new fetch from SPC's own GeoJSON service (format not yet confirmed). For the toggle UI,
  recommended a single small "Layers" icon button (opposite corner from the existing expand
  button) opening a compact checkbox popover, rather than adding 3 more chips to the already-dense
  zoom/product-select control clusters.
- **Nearby card hours filtering**: owner asked whether to only list confirmed-open (e.g. 24-hour)
  places. Recommended against a hard filter — OSM/Overpass hours data is frequently missing
  entirely (matches what's already observed: most places show "HOURS UNKNOWN"), so filtering to
  "confirmed open" would empty the list most of the time. Suggested keeping the full list but
  favoring visual/sort treatment for confirmed-open places instead of hiding unconfirmed ones.
- **Model data ingestion** (HRRR ideal, would take Nadocast/RAP/NAM 3km): owner asked if this is
  feasible. Two tiers discussed: (1) low-effort — point-forecast JSON APIs like Open-Meteo, which
  serve HRRR/NAM/RAP-derived values (CAPE, helicity, etc.) at a single lat/lon with no GRIB
  parsing at all, good for a diagnostics-style panel but not a map overlay; (2) higher-effort —
  true gridded overlays require pulling filtered/cropped GRIB2 subsets from NOMADS' grib-filter
  service (to keep payload size sane) and decoding GRIB2 client-side, which has precedent in this
  codebase (the NEXRAD Level II/III decoders were custom-integrated the same way) but is a
  meaningfully bigger lift than anything built this session. Nadocast's actual publish format
  (GeoJSON vs. image vs. raw grid) hasn't been checked yet and could change the calculus.

## Pending / next steps (in the order they came up)

1. **Continue the visual audit** beyond Weather-page-chase-mode — Normal mode, and the
   Operations/Locate/Alerts/Settings pages haven't had the same pixel-level pass yet. (In
   progress as of this writing — the owner asked for a full OCD-level pass across the entire
   dashboard and a written report.)
2. **Wire Spotter Network report submission** — build the UI for `POST /report/severe` (storm
   type checkboxes, hail size, wind speed, narrative, NWSChat/Twitter toggles) using the signed-in
   account's `id`. This is the owner's actual stated goal for the Spotter Network integration.
3. **Switch the Chasers feed to the official JSON positions endpoint** (`POST /positions`) once
   signed in — richer data (real phone/email/ham/twitter fields) than the current GRLevelX scrape,
   which stays as the anonymous/no-login fallback.
4. **OTA web-bundle updater** — owner wants to patch the app remotely over Tailscale without
   physically touching the tablet or the chase partner's device. Plan discussed but not built:
   host a `version.json` + zipped `dist/` build reachable over Tailscale, app checks on launch and
   swaps the bundle into local storage for the WebView to load from. Native-level changes (new
   permission, new plugin) still need `adb connect <tailscale-ip>:5555` + `adb install -r` — not
   fully OTA-able without an MDM.
5. **iOS build** — owner wants to eventually run this on iPad/iPhone. Blocker: iOS builds need a
   Mac + Xcode for signing, not available on this Windows dev machine. Options discussed: borrow
   Mac access, or a cloud Mac CI (Codemagic, GitHub Actions macOS runner).
6. **Nick's truck — single-ESP32-direct-to-iPad path**: Nick's vehicle won't have a Pi, just one
   ESP32 reading GPS + temp/humidity + anemometer, serving a small JSON HTTP endpoint the app
   would point at directly (same alias-based flexible parsing already used for the Pi). Not yet
   built; conceptually should be a drop-in once the endpoint exists, per `services/telemetry`'s
   existing alias-parsing design. Requires iOS support (see #5) if Nick's device is an iPad.
   **Distinct from the owner's own vehicle**, which already has 3 ESP32s feeding its Pi as
   normal — no change needed there.
7. Task backlog item from earlier in the project, still open: "Capture final screenshot and
   upload to Drive" (a one-off housekeeping task, not blocking).
