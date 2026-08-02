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
                                   useAlertProducts, useBattery, useBreadcrumbTrail)
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
  breadcrumbTrail.ts             — session-scoped vehicle position trail (module singleton,
                                   subscribe/notify, same shape as settings.ts) — new
  sound.ts                      — audible alert tone playback
  mapTiles.ts                    — Mapbox style/token helpers (Legacy map engine was deleted)
  radar.ts, radarLoop.ts         — NEXRAD fetch/decode
map/                             — Mapbox GL wrapper: AtlasMap.tsx (main component),
                                   AtlasCameraController, AtlasRadarLayer, AtlasVehicleLayer
                                   (vehicle dot + pulse animation), AtlasBreadcrumbLayer (trail
                                   line, new), AtlasRangeRingLayer, AtlasStyleManager,
                                   AtlasReconGlPage (full-screen expanded radar view)
native/radar-ref/                — Rust source for the ACTUAL radar decoder/renderer — see
                                   "Native radar renderer" section below before touching anything
                                   radar-related. This is not obvious from src/ alone.
```

## Native radar renderer — read this before touching radar rendering/colors

This tripped up an entire investigation this session, so it's worth stating plainly: **the code
that actually decodes NEXRAD data and paints radar pixels is not in `src/` and not in
`radar-worker/worker.cjs`.** Both of those either don't run on the shipped app or are
dead/prototype code (`radar-worker/worker.cjs` is a Node.js script with its own `pngjs` +
`nexrad-level-2-data`-based renderer that is **not invoked anywhere** in the shipped
app — confirmed via a repo-wide grep, nothing in `src/` imports those packages. Don't assume
editing it does anything on-device).

The real pipeline, confirmed by tracing `RadarNativePlugin.getFrames()` end to end:

1. **`android/app/src/main/java/com/codeblackwx/ops/radar/RadarNativePlugin.java`** — Capacitor
   plugin. Downloads raw Level II volumes directly from
   `https://unidata-nexrad-level2.s3.amazonaws.com/`, manages the on-disk raw/processed file
   cache, and calls a JNI `native` function (`renderLevel2ProductNative`) to do the actual
   decode+render. It has zero color/pixel logic itself — don't look here for that.
2. **`native/radar-ref/src/lib.rs`** — the JNI implementation, a Rust crate (`codeblack-radar-ref`,
   crate-type `cdylib`) built for `aarch64-linux-android` and compiled to
   `libcodeblack_radar.so`. This is the file that actually decodes the volume (via the
   `nexrad-data`/`nexrad-model` crates) and rasterizes it to a PNG (via the `nexrad-render`
   crate's `render_sweep()`), including the dBZ/velocity **color scale** — this is where any
   "what colors/thresholds does radar use" question actually gets answered or fixed.
3. The rendered PNG is written to `getFilesDir()/radar/sites/<site>/processed/`, and
   `RadarNativePlugin` returns its file path as `imageUrl`, converted via
   `Capacitor.convertFileSrc()`. `AtlasRadarLayer.ts` just drops it into Mapbox GL as a plain
   **image source** (`type: "image"`) covering `frame.bounds` — no tiling, no client-side
   rendering, no color logic on the JS side at all.

**Build/deploy loop for native/radar-ref changes** (documented in `native/radar-ref/README.md`,
confirmed working this session):
```powershell
$env:Path="$env:USERPROFILE\.cargo\bin;$env:Path"
$ndk="$env:LOCALAPPDATA\Android\Sdk\ndk\28.2.13676358"
$env:CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$ndk\toolchains\llvm\prebuilt\windows-x86_64\bin\aarch64-linux-android35-clang.cmd"
cd native/radar-ref
cargo +stable-x86_64-pc-windows-gnu build --target aarch64-linux-android --release
Copy-Item target\aarch64-linux-android\release\libcodeblack_radar.so ..\..\android\app\src\main\jniLibs\arm64-v8a\libcodeblack_radar.so -Force
```
Then the normal `npx cap sync android && cd android && ./gradlew.bat assembleDebug` + install —
Gradle's `mergeDebugNativeLibs` picks up the new `.so` automatically. **Important**: the plugin
caches rendered PNGs on-device keyed by volume filename, not by renderer version — after changing
the native renderer, use the "Clear Cache" button on the Operations page's Radar Engine panel (or
the underlying `clearRadarCache()`) to force fresh renders through the new code, or old frames
will keep showing until a new volume scan naturally arrives.

**Fixed this session**: the crate's stock `nws_reflectivity_scale()` paints its lowest bucket
(everything below 5 dBZ, including all negative-dBZ returns, which is most of what real super-res
reflectivity contains away from actual precip — ground clutter, biological scatter, noise floor)
as **opaque black** rather than transparent, so the whole sweep circle was covered in dark
speckle. Replaced with `codeblack_reflectivity_scale()` in `lib.rs` — identical color stops above
5 dBZ (still reads as standard NWS reflectivity), but that bottom bucket is now fully transparent
(`Color::rgba(0,0,0,0)`), matching the clean look of consumer viewers like RadarScope. Verified
via side-by-side on-device screenshots: same location, dense speckle across the whole frame
before, clean with only plausible actual-precip areas showing after.

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
15. **Radar reflectivity noise fix** (`native/radar-ref/src/lib.rs`, a Rust crate compiled to
    `libcodeblack_radar.so` over JNI — see the "Native radar renderer" section above, this is not
    in `src/`). The vendored `nexrad-render` crate's stock color scale painted everything below
    5 dBZ (including all negative-dBZ returns, most of what real ground clutter/biological scatter
    reads as) opaque black instead of transparent. Replaced with a custom scale, same colors above
    5 dBZ, transparent below. Also added dual-pol correlation-coefficient (CC) filtering on top,
    masking low-CC gates before rendering — built and deployed, but its real-world impact was
    inconclusive on the quiet-weather day it was tested against; needs a real storm to confirm.
16. **Spotter Network severe report submission** — moved to its own dedicated page (dock icon
    "RPT") rather than a modal on the Nearby card, plus a shortcut button at the bottom of the
    Alerts page, after the owner asked for the Nearby card to never scroll. Full form (hazard
    checkboxes, hail/wind conditionals, narrative, NWSChat/Twitter toggles), GPS auto-filled,
    gated behind sign-in. `src/components/situational/ReportPage.tsx`.
17. **Nearby card refinements**: hospital match now requires OSM's `emergency=yes` tag (a plain
    "hospital" match can be a rehab/specialty facility with no ER — confirmed live via Overpass
    that this is a real gap, not hypothetical) and is labeled "ER" instead of "Hospital". Category
    selection was reworked from "pick the closest" to a ranked scoring model: confirmed-open beats
    typical-open beats unknown beats closed, with bed count as a secondary tiebreak for ER
    (capability proxy, since OSM has no rating system) and distance only as the final tiebreaker.
    Verified live on-device — Gas and Lodging both correctly swapped from a closer
    "typically open"/unknown pick to a farther confirmed-open one.
18. **Wind card typography fix + charging icon**: Wind's hero numbers had a bespoke
    `clamp(28px, 2.8vw, 42px)` independent of the shared metric-tile sizing Location/Conditions
    use, making it read oversized next to its row neighbors — matched to Conditions' exact
    per-mode clamp. `useBattery()` now also exposes `isCharging`; the header battery chip shows a
    small amber lightning-bolt icon when charging.
19. **Wind card structural redesign + peak-hold gust** (`WindCard.tsx`/`WindCard.css`): the card
    used to stack Speed/Direction in a single column, leaving the whole right half of the card
    empty except a floating "GUST --" label — exactly the "too much missing space" complaint.
    Reworked into a 2-column grid: Speed/Direction stacked on the left, a new **Peak Gust** tile
    (session-scoped high-water-mark, tap to reset, small "now X" live-gust annotation) filling the
    right column that used to be dead space. While building this, found and fixed a much older bug:
    ~7 separate leftover `.wind-panel { display: grid; grid-template-columns... }` blocks (plus
    dozens of `.wind-compass`/`.wind-readout`/`.wind-spark` rules) from a pre-rebuild compass-based
    Wind card design were still scattered across `index.css` and clamping the new layout into a
    stale 2-column split, causing severe text truncation. Confirmed via grep that none of those
    class names exist in any `.tsx` file anymore (100% dead). Rather than hunt every occurrence in
    a 5800-line file under time pressure, applied the same proven fix pattern as `.bottom-dock`/
    `.dock-signature` below: a definitive `display: flex !important; flex-direction: column
    !important;` override in `WindCard.css`. The full dead-CSS purge is flagged as a separate
    follow-up task (spawned, not yet run) rather than rushed inline.
20. **Nearby card resilience fix** (`hooks/useNearbyPlaces.ts`): a real-world incident — the card
    got stuck showing "NEARBY LOOKUP UNAVAILABLE" after a transient network blip (during a USB
    cable swap, tablet has its own WiFi so this was unrelated to that) — exposed two gaps in the
    existing polling hook: (1) it only retried every 10 minutes flat, even on failure, so one bad
    request could leave the card stuck for up to 10 min; (2) on any fetch error it wrote `{}` into
    state, wiping the last successfully-fetched places instead of keeping them, inconsistent with
    the "always visible, last-known over blank" pattern used everywhere else in this app (the
    earlier telemetry-fallback work). Fixed both: failures now retry with a 30s-doubling backoff
    capped at the normal 10-min cadence, and a failed fetch keeps whatever places were last shown
    instead of blanking the card.
21. **Pulsing vehicle dot + breadcrumb trail** (owner's idea from a prior discussion, now built):
    - `map/AtlasVehicleLayer.ts` gained a `atlas-vehicle-pulse` circle layer, animated via a
      `requestAnimationFrame` loop (`startAtlasVehiclePulse`) that grows the radius and fades the
      opacity on a ~1.8s cycle so "my dot" reads at a glance. Started once in `AtlasMap.tsx`'s
      `initializeStyle` and stopped on unmount; the tick function no-ops safely if the layer
      doesn't exist yet (e.g. before a first GPS fix).
    - New `services/breadcrumbTrail.ts`: a module-level singleton (same subscribe/notify shape as
      `services/settings.ts`) tracking `{lat, lon, at}` points, capped at 3 hours, recording a new
      point only every ≥15m of movement to keep the array bounded over a multi-hour drive.
      Deliberately in-memory only, no Preferences persistence (a trail from a prior chase shouldn't
      linger into today's) and no server sync (owner explicitly flagged that as future work, not
      asked for now). Built as a shared singleton rather than per-component state because
      `AtlasMap` can be mounted more than once simultaneously (Weather page's map card + Locate
      page both render it) and must show one continuous trail, not one each.
    - New `map/AtlasBreadcrumbLayer.ts` renders it as a semi-transparent (`line-opacity: 0.32`) red
      line under the vehicle marker. New `hooks/useBreadcrumbTrail.ts` is the thin React wrapper.
    - A new "CLR" button was added to `AtlasMap`'s existing zoom/follow/range-ring control cluster,
      disabled when the trail is empty, calling `clearBreadcrumbTrail()`.
    - Verified structurally in the browser preview (both concurrently-mounted map instances show
      the same disabled CLR button with an empty trail, no console errors after the pulse rAF loop
      ran for several seconds with no vehicle layer yet); full visual verification needs a real GPS
      fix on-device, not yet done as of this writing.
22. **Peak-hold gust wired into the severe report form**: the Wind card's peak-gust tracking moved
    from local component state into a new `services/peakGust.ts` module singleton (same
    subscribe/notify shape as `breadcrumbTrail.ts`/`settings.ts`) so `ReportPage.tsx` can read the
    same value. When the Wind hazard checkbox is on and the Wind Speed field is still empty,
    `ReportPage.tsx` shows a small amber "Use Peak Gust (N mph)" suggestion button next to the
    input — tapping it fills the field and sets Measured (not Estimated). Deliberately a tap-to-fill
    suggestion, not a silent auto-fill, so it never overwrites something the owner already typed.

23. **Chasers feed switched to the official Spotter Network JSON API when signed in**
    (`services/spotters.ts`'s new `getAuthenticatedSpotterPositions()`, wired into
    `hooks/useSpotters.ts`). Response shape was pulled live from the Apiary interactive docs (not
    guessed from memory) before writing any parsing code — confirmed
    `POST https://www.spotternetwork.org/positions` with body `{id}` returns
    `{positions: [{report_at, lat, lon, callsign, email, phone, ham, twitter, web, first, last,
    marker, ...}]}`, every field a string even when numeric-looking, most contact fields nullable.
    `useSpotters.ts` now subscribes to the signed-in account and prefers this endpoint when an `id`
    exists, falling back to the anonymous GRLevelX feed on any error (network blip, revoked id) or
    when signed out — never just shows nothing. Richer contact data (real phone/email/ham/twitter/
    web instead of whatever free text a spotter typed into a GR2Analyst tooltip).
    - Along the way, found and fixed the same latent bug in two other new module singletons this
      session (`breadcrumbTrail.ts`, `spotterAccount.ts`): a `subscribeX()` returning
      `() => set.delete(listener)` directly types as `() => boolean`, which fails when that
      function is returned straight from a `useEffect` callback (`Destructor` must be `void`).
      `services/settings.ts`'s existing `subscribeChaserRadiusMiles`/`subscribePiEndpoint` have the
      identical shape but happened to avoid the error because their call sites wrap the unsubscribe
      call rather than return it directly — not broken today, but the same latent footgun.
24. **Wide-area mosaic context layer + cinematic intro zoom**. The owner initially asked for a
    custom multi-radar mosaic (composite 2-3 NEXRAD sites in native Rust, reprojecting onto a
    shared grid). Researched it thoroughly (two Explore agents covering the JS/Android data flow
    and the vendored `nexrad-model`/`nexrad-render` crates) and confirmed it's buildable but a
    genuinely large native-code project — see the plan file for the full writeup if this ever gets
    revisited. Talking it through surfaced the actual need: the owner will keep using RadarScope as
    the primary chase/analysis tool (that's where hook-echo-level detail and color-scheme control
    matter), and this app just needs situational awareness — "where am I relative to the storm, my
    team, and other spotters." That doesn't need custom-composited super-res data. **Dropped the
    native compositing plan entirely** and instead wired in RainViewer's free public tile mosaic
    (`services/situational.ts`'s `getRadarTileTemplate()` already existed for this, fetched, never
    used anywhere — confirmed via grep) as a new `map/AtlasMosaicLayer.ts` raster layer, toggled by
    a new "MSC" button in the map controls, defaulting **on** (owner's explicit call: "mosaic on by
    default... don't delete atlas" — the single-site view stays fully intact as the manual
    fallback, its own color scale/CC filter untouched).
    - Hit a real bug during device verification: RainViewer's documented max zoom is 7, but this
      app's map operates at zoom 7.25-9.2, so Mapbox was requesting tiles beyond what exists and
      getting back a "Zoom Level Not Supported" placeholder image baked right into the tile. Fixed
      with `maxzoom: 7` on the raster source (standard Mapbox behavior: stop requesting past that
      zoom, over-zoom/upscale the z7 tile instead) — confirmed fixed via before/after screenshots.
    - Also added a "premium" cinematic intro: the map now constructs at a wide establishing zoom
      (4.5) and `flyTo()`s down to the real operating zoom on cold launch, reusing the same
      ease-out-cubic curve (`1 - (1-t)**3`, "starts fast, slows to a stop") already used for normal
      recentering elsewhere in `AtlasCameraController.ts`, just with a longer (2.8s) duration.
      Confirmed via a mid-flight screenshot (map still wide/loading) vs. the settled end state.
    - Verified on-device: MSC toggles cleanly on/off with no stray rendering left behind (checked
      with the single-site radar layer also toggled off, to see the mosaic layer in isolation).
      Couldn't visually confirm actual radar echoes render correctly, though — no precipitation in
      range on the day this was tested, same "needs a real storm" caveat already logged for the CC
      clutter filter. The plumbing is confirmed correct (no placeholder/error tiles, toggle works,
      tile fetch returns real data when called directly); only the "does colored precip actually
      show up" part is unconfirmed.

All of the above (items 1-24) were built, `npm run build` typechecked clean, and have now been
synced/compiled/installed to the physical tablet and screenshot-verified on-device, including:
Wind card's 2-column grid with no text truncation at real (non-placeholder) values; Nearby loading
a full ranked list; the map's CLR trail-clear control present and enabled; a real frame-to-frame
pixel diff around the vehicle dot confirming the pulse animation is actually running on-device (not
just in the browser preview); the report form correctly *not* showing the "Use Peak Gust" suggestion
when no gust has been recorded yet (confirms the conditional gating, not just its presence); and the
Chasers card returning live results while signed in. Not yet exercised: the breadcrumb trail's
actual line rendering (needs the tablet to physically move — a stationary vehicle correctly
produces a single point and no line, which is expected, not a bug) and the Nearby retry-on-failure
path (needs a real or simulated network outage to trigger).

## Open discussion threads (not yet built, owner said "just thoughts" / asked for a recommendation)

- **Map overlays**: owner wants warning polygons, SPC Mesoscale Discussion polygons, and Spotter
  Network position pins on the map (`AtlasMap.tsx`), each independently toggleable so the map
  doesn't get cluttered. Owner confirmed this is next after the mosaic work above. Recommended
  approach (not yet built): warning polygons are nearly free — `api.weather.gov/alerts/active`
  (already polled for the Alerts page) carries a GeoJSON `geometry` per feature that's currently
  discarded; spotter pins reuse existing position data. **Correction to an earlier note**: MD
  polygons do NOT need a new/unconfirmed fetch — `services/situational.ts`'s
  `getActiveMesoscaleDiscussions()` already successfully queries SPC's own GeoJSON service
  (`mapservices.weather.noaa.gov/.../spc_mesoscale_discussion/MapServer/0/query`) for point-in-
  polygon checks and just discards the geometry afterward; reuse that, don't build a new fetch.
  For the toggle UI, recommended a single small "Layers" icon button (opposite corner from the
  existing expand button) opening a compact checkbox popover, rather than adding 3 more chips to
  the already-dense zoom/product-select control clusters. `AtlasMosaicLayer.ts`'s z-order pattern
  (check if a layer already exists before choosing `beforeLayerId`) is a directly reusable
  precedent for inserting these without fighting the existing radar/vehicle/breadcrumb layers.
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
2. **Wire Spotter Network report submission** — DONE (`ReportPage.tsx`, see Recent Work #16, #22).
3. **Switch the Chasers feed to the official JSON positions endpoint** — DONE (see Recent Work
   #23). Anonymous GRLevelX feed stays as the fallback (signed-out, or the authenticated call
   fails). Not yet tested against a real signed-in account on-device.
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
7. **Typography consistency pass** — DONE for Wind vs. Conditions specifically: Wind's hero numbers
   had a bespoke `clamp(28px, 2.8vw, 42px)` independent of the shared metric-tile sizing, matched
   to Conditions' exact per-mode clamp instead. A broader dashboard-wide font audit beyond this one
   flagged pair has not been done.
8. **Wind card redesign** — DONE (see Recent Work #19): 2-column grid, Peak Gust tile fills the
   space that used to be empty. Peak-gust-to-report-form wiring is also DONE (Recent Work #22).
   Still open: purging the ~7 confirmed-dead legacy `.wind-panel`/`.wind-compass` CSS blocks found
   in `index.css` during this work (a background task was spawned for this, not yet run).
9. **Radar: real-storm verification needed** — the CC-based clutter filter (see above) showed no
    clear visual improvement on today's quiet-day data, and the raw CC product view itself looked
    unusually chaotic rather than the smooth pattern real precip normally shows. Not clear yet
    whether that's correct behavior (today's returns genuinely low-correlation) or a bug in the
    gate-alignment logic. Needs testing against an actual storm, and worth re-checking the
    `apply_correlation_filter` gate-matching logic in `native/radar-ref/src/lib.rs` if it still
    looks wrong then.
10. **Multi-radar mosaic on the tablet, custom native compositing** — DECIDED AGAINST for the
    tablet app (see Recent Work #24): researched thoroughly (buildable, ~moderate new Rust code on
    top of correct vendored primitives), but the owner will keep using RadarScope as the real
    chase/analysis tool, so a free pre-composited tile mosaic (now built) covers the actual need
    without native-code risk. The technique below is still legitimate and would still apply if this
    ever gets revisited for the *PC big-board* idea (#11) specifically, where custom compositing
    would be worth it for a non-driving analysis display: legitimate technique, same as
    NWS's MRMS national mosaic. Recommended approach if built: **max-value compositing** on a
    reprojected common grid for REF/CC (take the strongest/best-angle value per pixel across
    nearby radars, not an average — averaging would weaken real signal against distant-radar
    overshoot). Velocity is much harder to composite correctly (radially relative to each radar's
    own position; real blending needs dual-Doppler wind synthesis) — recommended to keep VEL as
    single-best-radar rather than attempting to blend it. Promising sign: the `nexrad-model` crate
    already vendored here includes a `CartesianField` type built for exactly the polar-to-common-
    grid reprojection this would need.
11. **PC/desktop "big board" app** (owner's idea, discussed, not started) — a second, non-driving
    target distinct from the tablet cockpit: animated radar loop with a choreographed camera cycle
    (close zoom ~8-12s → normal ~30s → regional-wide → normal ~2min → repeat), a toggleable "my
    team" position layer, and ideally a proper Level III multi-radar mosaic. This bundles three
    projects of very different sizes — recommended NOT to build them together:
    - Cinematic auto-cycling camera: small, self-contained, no new data pipeline, buildable on the
      existing tablet map today (`AtlasCameraController.ts` is the natural home for it). Mapbox
      GL's `easeTo()`/`flyTo()` already supports exactly this kind of keyframed camera animation.
    - Team position toggle layer: small-medium, same shape as the Spotter Network pins/toggle
      already scoped for the map-overlays feature — either filter the existing Spotter Network
      feed to known team members, or build a simple shared-position endpoint over the team's
      existing Tailscale network (avoids depending on Spotter Network for internal team tracking).
    - PC packaging + Level III + mosaic: the big one. The existing React/Mapbox GL frontend is
      largely platform-agnostic and could plausibly run under Electron/Tauri with real but modest
      porting effort; the Rust radar decoder (`native/radar-ref`) is not Android-specific code, so
      recompiling it for a desktop OS target is tractable — but Level III decode and the mosaic
      compositing (#10) are both still fully unbuilt subsystems. Treat as its own dedicated
      initiative to scope separately, not a quick add-on.
12. **Pulsing "my position" dot + breadcrumb trail** — DONE and on-device verified (pulse
    confirmed via a real frame-to-frame pixel diff around the dot; CLR button confirmed present and
    enabled). Still open: seeing the trail actually draw a line (needs the tablet to physically
    move more than 15m — correctly shows zero line while stationary, that's not a bug), and the
    owner's own stated future step of syncing the trail to a server for team visibility — not
    asked for yet, don't build until requested.
13. **Discord posting on report submission** — owner is planning to stand up a Discord for the
    Code Black team and wants a "post to Discord" toggle added next to the existing NWSChat/
    Twitter toggles on the severe report form (`ReportModal` in `NearbyPanel.tsx`) once that
    Discord exists. Explicitly flagged as future-only, not to build yet — no webhook URL or server
    exists to wire up.
14. **Wide-area mosaic tile layer** — DONE (see Recent Work #24). Confirmed the plumbing is
    correct (toggle works cleanly, no error/placeholder tiles, tile fetch returns real data) but
    couldn't confirm actual colored precipitation renders correctly — no precip in range on a quiet
    weather day. Worth a quick visual recheck next time there's real rain/storms anywhere in the
    national coverage area.
15. **Single-site radar mode needs a fine-tuning pass** — owner's own words, right after the mosaic
    work: "not fully happy with it yet." No specifics given yet on what's wrong with it — this
    needs a follow-up conversation to scope (typography? color scale? controls? something else?)
    before touching it, rather than guessing.
