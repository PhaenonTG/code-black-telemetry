# Code Black OPS — Project State

Last updated: 2026-08-03 (app-wide evaluation + animated splash screen, item #34+). Written so a
fresh AI assistant (or a human) can pick this project up cold, with no prior conversation history,
and know exactly what exists, why, and what's next.

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
  settings/SettingsPage.tsx     — Display (Cockpit Mode, Night Vision) / Alerts / Pi Connection /
                                   Spotter Network / Nearby Chasers / Team Roster / Map Pins /
                                   Interior Lighting / About — 9 panels, see the page-grid sizing
                                   pitfall in "Established conventions" before adding a 10th
  ui/                            — SourceBadge, StatusBadge, DashCard, MetricRow
  ErrorBoundary.tsx               — now auto-reloads on crash after an 8s countdown, with a
                                   sessionStorage crash-loop guard (3+ reloads/2min disables
                                   auto-reload) -- was previously a manual-tap-only reload screen
  SevereFlashOverlay.tsx          — full-screen red pulse on a new tornado/PDS alert, new
hooks/                          — one hook per data source (useTelemetry, useNearbyPlaces,
                                   useSpotters, useTabletLocation, useSituationalData,
                                   useAlertProducts, useBattery, useBreadcrumbTrail,
                                   useResumeTick — forces an immediate refetch on Capacitor
                                   foreground resume, new)
services/
  telemetry/                    — the Pi data pipeline: types.ts, api-provider.ts (polls Pi via
                                   HTTP, normalizes payload, last-known fallback, now ALSO merges
                                   in BLE telemetry and prefers it when fresh), simulator.ts (dev
                                   fake data), quality.ts (freshness/age/alias-parsing helpers),
                                   fallback.ts (merges vehicle vs NWS station data),
                                   ble-client.ts (new — see "Raspberry Pi backend" section below,
                                   this is the primary Pi link now, not HTTP)
  severeFlash.ts                  — module singleton, triggers SevereFlashOverlay, new
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

## The Raspberry Pi backend ("PiWX") — read this before touching anything Pi/BLE-related

**This is a separate, mature codebase that does not live in this repo.** It lives on the actual
Pi at `~/CodeBlack` (hostname `raspberrypi.local`, SSH user `codeblack`, not `pi` — the default-user
assumption cost real time this session). It's a full Flask app + BLE bridge + lighting controller
+ ESP32 serial bridge, built independently (by the owner's own sessions running Claude/Codex
directly on the Pi, evidenced by `.claude`/`.codex` dirs in `~/CodeBlack`) — this tablet app is
one client of it, not the only thing that exists. Do not assume "not in src/" means "not built."

- **SSH access**: `ssh codeblack@raspberrypi.local` (Pi must be on the same WiFi/LAN as whoever's
  connecting; there is no way to reach it from outside that network without something like
  Tailscale). Public key auth was set up this session — if it stops working, the fallback is
  having the owner add a new key to `~/.ssh/authorized_keys` (never send/use a password directly,
  see Credential Handling below).
- **What's there** (`~/CodeBlack`): `dashboard/app.py` (Flask, port 5000, `http://pidash.local:5000`
  or `http://<pi-ip>:5000`), `codeblack_ble/` (the BLE bridge to the tablet, see below),
  `esp_bridge/` (reads ESP32 sensor JSON over serial), `lighting/` (Govee H7090 interior light
  control, its own BLE connection to the lamp, unrelated to the tablet's BLE link), `integrations/`
  (NWS alerts, Spotter Network, storm motion — the Pi has its OWN copies of some of the same
  external-API integrations this tablet app has, built independently; they are not the same code
  and don't need to match). Extensive docs already exist there: `STATUS.md`, `CHANGELOG.md`,
  `docs/BLE_PROTOCOL.md`, `docs/BLE_ARCHITECTURE.md` — read those on the Pi itself before making
  Pi-side changes, don't just infer from this file.
- **Vehicle identity mismatch, unresolved**: the Pi's own `STATUS.md` self-identifies as
  `Vehicle ID: spencer-charger` / `Operator: Spencer Tucker` — not obviously the owner's own
  vehicle identity used elsewhere in this tablet app. Never confirmed whether this is stale
  default/demo config or a real distinct identity. Flag this to the owner before assuming either
  way if it matters for a future feature.

### BLE link (tablet <-> Pi), built this session

The owner wants the Pi link to work over **Bluetooth specifically, not WiFi/HTTP** — deliberately,
so it doesn't depend on Starlink/a hotspot being powered in the vehicle. The tablet's existing
HTTP-based `PiEndpointPanel`/`api-provider.ts` path still exists and still works if configured, but
BLE is now the **primary** path and HTTP is a secondary/legacy fallback.

- **Protocol** (`~/CodeBlack/docs/BLE_PROTOCOL.md` on the Pi is the source of truth, not this
  file): service UUID `8f2a0000-6d6f-4f9f-9d8b-0c0d2b4c0001`, advertised name `CodeBlack-OPS`.
  Live telemetry notifies on `8f2a0003-...` as compact JSON, fragmented into `telemetry_fragment`
  frames (keyed by `seq`/`i`/`n`) when the payload exceeds `CB_BLE_MAX_PAYLOAD_BYTES` (180 by
  default — a real telemetry payload is ~435 bytes, so fragmentation into ~6 frames is the normal
  case, not an edge case).
- **Tablet side**: `src/services/telemetry/ble-client.ts` (`bleTelemetryClient` singleton) owns
  scan/connect/subscribe/reconnect. `api-provider.ts`'s `HybridTelemetryProvider` prefers a fresh
  BLE notification over its own HTTP poll (`poll()` skips entirely while BLE has published within
  the last 6s) and maps the compact BLE schema onto the same `TelemetrySnapshot` shape the HTTP
  path already produced, so nothing downstream (UI components, `useStatus()`, etc.) needed to
  change. BLE pauses/resumes with the same Capacitor `appStateChange` listener the HTTP path
  already used (`setTelemetryPaused`).
- **Reconnect backoff**: the scan/connect retry loop uses exponential backoff (5s -> 90s cap),
  not a flat interval — a flat interval was shipped first and produced near-continuous active BLE
  scanning (one of the most power-hungry radio ops on Android) whenever the Pi was unreachable,
  which is the most likely explanation for a battery-drain report the same day. Don't regress this
  back to a flat retry interval.
- **Command channel** (write to `8f2a0006-...`, response on `8f2a0007-...`, matched by a client-
  generated `req_id`): token-authenticated (`CB_BLE_COMMAND_TOKEN`, set only in the Pi's
  `/etc/codeblack/codeblack-ble.env`, never in source control), strict allowlist, rate-limited
  (0.5s/command). Tablet side: `bleTelemetryClient.sendCommand(cmd, extra)` in `ble-client.ts`,
  token entered once in Settings -> Interior Lighting -> Command Token (stored via
  `services/settings.ts`'s `bleCommandToken`, plain Preferences, matches how `piEndpoint` is
  stored — this is a shared secret for controlling vehicle hardware, not a personal credential, so
  the plaintext-storage precedent from Spotter Network applies the same reasoning). Allowlisted
  commands: `get_snapshot` (live), `set_lighting` (live — power/profile/color, relays to the Pi's
  own local `/api/local/lighting/*` Flask endpoints), `set_storm_mode` (live — switches to one of
  the Pi's alert-severity lighting profiles), `start_chase_session`/`end_chase_session` (live —
  switches lighting profile to `chase`/`standby`), `ack_alert` (live but audit-log-only by design —
  does not touch the Pi's own automatic alert-driven lighting automation, which is safety-relevant
  and wasn't touched without explicit direction).
- **Interior Lighting** (Settings page): power on/off, profile quick-select, 6 color presets
  matching the Pi's own `lighting/api.py` `PRESET_COLORS` exactly. A real Govee H7090 lamp is
  already paired to the Pi (`D7:C1:83:C6:47:7C`) on its own separate BLE connection (`hci0`, not
  the tablet's `hci1` — confirmed no adapter conflict, `lighting.json`'s
  `allow_codeblack_ble_adapter_share` was already `true` from a prior Pi-side session). The lamp
  itself may not always be connected/in-range; that's a normal `state: OFFLINE` response from the
  Pi, not an error — the command still round-trips successfully.
- **Fixed a Pi-side bug that predates this session**: `/run/codeblack` was `root:root` mode `755`
  because `codeblack-ble.service` runs as root and recreates that `RuntimeDirectory` on every
  restart — the Flask dashboard (`mobile-mesonet-dashboard.service`, runs as user `codeblack`)
  could never write `lighting-commands.jsonl` into it, silently breaking lighting control **for
  the whole Pi**, not just via BLE. Fixed permanently in the systemd unit (`Group=codeblack` +
  `RuntimeDirectoryMode=0775`), not just chmod'd by hand (which would've reverted on next restart).
- **Not yet done**: pairing/trusted-device policy beyond the shared token (the Pi's own foundation
  report flags this explicitly); real behavior tied to actual chase-session/storm-mode semantics
  beyond "switch a lighting profile" (that's genuinely all `start_chase_session`/`set_storm_mode`
  do today — there's no other session-state concept on either side yet); a tablet-side UI for
  triggering `start_chase_session`/`end_chase_session`/`set_storm_mode` (only `sendCommand()` the
  plumbing exists — no button calls them yet, only Interior Lighting's controls are wired to UI).

## The 5 pages (App.tsx pager)

1. **Weather** (`/`, default) — 2x3 grid: Location & Motion, Conditions (WeatherObservationPanel),
   Wind, Active Alerts (compact), Situational Map, Nearby (amenities + Chasers).
2. **Operations** (`/operations`) — diagnostics-heavy: mode summary, Sensor Health, System, Power,
   Radar Engine panel, Pi Endpoint config, Events log, raw diagnostics grid.
3. **Locate** (`/locate`) — full-page map (same `MapRadarPanel`/`AtlasMap` as Weather page, second
   instance).
4. **Alerts** (`/alerts`) — `AlertsFullPanel`: uncapped product list + Storm Threat summary cards
   (watch/MD/warning) — these two were merged into one component this session.
5. **Settings** (`/settings`) — 9 panels now: Display (cockpit mode + Night Vision toggle),
   Alerts (sound on/off + test), Pi Connection, Spotter Network (sign in/out), Nearby Chasers
   (search radius), Team Roster, Map Pins (color/shape pickers), Interior Lighting (Govee control
   over BLE), About. See "Established conventions" below for a real bug this grew into.

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
- **CSS Grid page containers sized for a fixed panel count are a real, recurring bug class.**
  `.page-grid--settings` was hand-written for 4 panels (`grid-template-rows: repeat(2,
  minmax(0,1fr))`) and silently grew to 9 over several sessions without anyone updating that rule.
  CSS Grid gives content-sized *implicit* rows their full natural height first; if that already
  consumes all the container's available space, the *explicit* `1fr` rows get squeezed to their
  minimum (0, since `minmax(0, 1fr)` allows it) — the first 4 panels (Display/Alerts/Pi Connection/
  Spotter Network) were rendering at **zero height and were completely inaccessible**, not just
  visually off. Found by accident while debugging an unrelated new panel's own layout; could have
  gone unnoticed indefinitely since the page still "looked fine" (just short by 4 panels). Fixed
  by switching to `grid-auto-rows: minmax(0, auto)` + `overflow-y: auto` on the grid, so it scrolls
  instead of squeezing. **If any other `page-grid--*` variant grows panels over time, check whether
  its `grid-template-rows` still matches the actual panel count** — `page-grid--operations` in
  particular already has quite a few cards and hasn't been audited for this specific failure mode.
- **`overflow-y: auto` on a flex-column panel doesn't stop its children from shrinking below
  content size** — `min-height: auto` computes to `0` for flex items inside a scroll container
  (a well-known CSS spec gotcha), so adding `overflow-y: auto` alone to a `.cb-panel` with too much
  content can squeeze its `.settings-row` children into overlapping garbage instead of actually
  scrolling. The fix used throughout Settings this session: `overflow-y: auto` on the panel *and*
  `flex-shrink: 0` on its `.settings-row` children. Copy both together, not just the overflow rule
  — `.radar-endpoint-panel`'s original fix (Operations page) predates this discovery and only has
  the overflow half; it happens to not need the shrink fix today, but if its content ever grows,
  check for the same symptom.

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
25. **Animated the mosaic layer** — owner asked for it to loop through recent history (10-20
    frames) 3-4 times, hold on the latest frame for ~20s, then repeat, with the earlier maxzoom fix
    guaranteed to survive every frame transition. `getRadarTileTemplate()` became
    `getRadarMosaicFrames()`, returning RainViewer's full `radar.past` array (13 frames on the day
    this was tested) instead of just the latest. `AtlasMosaicLayer.ts` gained
    `startAtlasMosaicAnimation()` — a self-contained imperative loop (same ref-driven pattern as
    the vehicle pulse, not React state, to avoid a re-render every ~400ms) using Mapbox's
    `RasterTileSource.setTiles()` to swap the active tile template in place. `maxzoom` is set once
    on the source itself at creation, not per-frame, so it survives every `setTiles()` call by
    construction.
    - Verified with a temporary debug `console.log` (added, confirmed, then removed before commit)
      captured live via `adb logcat` — the established method in this project for on-device JS
      console output. Directly confirmed: all 13 frames cycle through in order and correctly wrap
      back to frame 1 for the next loop; measured a **19.8-second gap** between the last frame of a
      loop and the first frame of the next cycle, matching the intended 20s hold almost exactly.
      This is airtight verification of the actual mechanism (not blocked by the "no precip today"
      visual-confirmation gap that affects whether real echoes render correctly in the tiles
      themselves — that part is still only confirmed via item 24's plumbing-level check).
    - Hit real friction verifying this in the browser dev preview: repeated HMR reloads across many
      edits this session exhausted the browser's WebGL context budget (`WEBGL_CONTEXT_LOST`),
      unrelated to the code itself — the physical device never showed this. Don't read a dev-preview
      WebGL error as a code regression without also checking the device.
26. **Map overlays: warning/MD polygons + personalizable Team/Chaser pins**. Researched first
    (confirmed `api.weather.gov/alerts/active`'s `geometry` field is nullable — most watches/
    statements are zone-based with no polygon at all, only storm-based warnings carry one — and
    that `getActiveMesoscaleDiscussions()` already fetched and correctly parsed MD polygon geometry,
    just discarded it after a point-in-polygon check). `AlertProduct` gained a `geometry` field, now
    kept instead of discarded in both `getNwsAlerts()` and `getActiveMesoscaleDiscussions()`.
    - New `map/AtlasAlertsLayer.ts`: fill+outline for storm-based warnings (red), separate dashed
      muted-white outline-only layer for MDs (a discussion, not yet a warning — deliberately
      distinct from a real warning at a glance).
    - Expanded scope mid-build per the owner: a **Team** pin layer, visually distinct from generic
      Spotter Network "Chaser" pins, with **fully personalizable color + shape** for both (native
      `<input type="color">` plus 5 shape choices, confirmed via `AskUserQuestion` — the owner
      explicitly wanted real color freedom over a curated palette, "I'm all about personalization").
      Shape choice ruled out plain Mapbox `circle` layers (GL circles are, definitionally, circles)
      without generating per-color/per-shape canvas icon images — used `mapboxgl.Marker` with a
      CSS-styled DOM element instead (new `map/AtlasPinMarkers.ts`, a genuinely new pattern for this
      codebase's map layers, which are otherwise all GL sources/layers, not DOM markers).
    - "Team" has no dedicated data source yet — the owner's own vehicle's Pi/ESP32 GPS could
      eventually report positions directly (e.g. over Tailscale) but that's unbuilt infrastructure.
      Confirmed interim approach: a Settings-managed roster (`services/teamPositions.ts`'s
      `resolveTeamPositions()`, a pure function) filters the *already-fetched* Spotter Network feed
      into Team vs. Chasers by name/marker-ID match — deliberately isolated so swapping in a real
      position feed later only touches this one function, not the map layer or its styling.
    - New Settings sections: "Team Roster" (add/remove list of names/marker IDs) and "Map Pins"
      (color picker + shape row for both Team and Chaser pins, `services/settings.ts` extended with
      the same get/save/subscribe-triplet pattern already used for `chaserRadiusMiles`/`piEndpoint`,
      changes apply live with no separate "Apply" step — same as the rest of this app's settings).
    - New "LYR" button on the map opens a small popover with three independent checkboxes (Alerts,
      Team, Chasers), all defaulting **on** — same "default visible, opt out if it's too busy"
      philosophy as the mosaic's MSC toggle.
    - **Verified end-to-end on-device**, not just piece-by-piece: added a real nearby spotter
      ("Douglas Keck," visible via the Chasers card) to the Team roster from Settings, then
      confirmed his actual map pin switched live from the default Chaser style (white circle) to
      the default Team style (green diamond) at the same real-world position — proves the full
      pipeline (Settings -> Preferences -> subscribe -> `resolveTeamPositions` split -> layer
      render) is correct with real data, not just each piece in isolation. Also confirmed: the
      Layers popover opens/toggles correctly (browser + device), Settings color/shape pickers
      repaint the map live, no console errors with empty alerts/spotters arrays (the common case).
      Not confirmed: whether warning/MD polygons actually render correctly, since there were no
      active alerts with geometry on the day this was tested — same "needs real weather" gap
      logged for the CC filter and the mosaic tiles earlier.

27. **Purged the dead compass-era Wind card CSS from `index.css`** — the pre-redesign compass gauge
    layout (`.wind-compass`, `.wind-ring`, `.wind-arrow`, `.wind-readout`, `.wind-trend-label`,
    `.wind-spark`, `.wind-gust`/`.wind-gust--missing`) left ~15 scattered dead rule blocks plus
    several superseded `.wind-panel { display: grid; ... }` internal-layout blocks (fully
    superseded by `WindCard.css`'s `.wind-panel.cockpit-card { display: flex !important; ... }`
    override from item #19) still sitting in the file, confirmed via grep to have zero remaining
    references in any `.tsx` file. Worked through the file region-by-region, deleting only the
    confirmed-dead internal-layout rules while explicitly preserving live page-positioning rules
    using the same `.wind-panel` selector (`grid-column`/`grid-row`/`grid-area` placement within
    `page-grid--weather`) and the still-live `.wind-toolbar` class. Also removed the now-orphaned
    `@keyframes compass-breathe` (only referenced by the deleted `.wind-ring` rule). Net: 448 lines
    deleted, zero live rules touched (caught and fixed one near-miss over-deletion of
    `.wind-toolbar { padding-bottom: 10px; }` before it was ever built/committed). `npm run build`
    clean, device-verified (Wind card, the shared Location/Conditions/Wind footer band, and the
    Atlas radar strip all render identically to before).

28. **Dashboard polish + reliability pass**: fixed the map's control-button stack (7 buttons in a
    single column) overlapping the radar status strip on the compact dashboard card — switched to
    a 2-column grid, also bumped from 36px to 44px touch targets. Bumped spotter/team pin markers
    from 14px to 20px with a glow ring — the old size was functionally invisible at a glance
    against the map (confirmed the underlying data/rendering was fine; it was a pure visibility
    problem). Fixed a duplicate-event-ID bug in `api-provider.ts`'s `offlineSnapshot()`
    (`evt-${now}` collided when two offline events landed in the same millisecond, dropping
    Operations-page Events entries). Added `useResumeTick` + wired it into
    `useAlertProducts`/`useNearbyPlaces`/`useSpotters` — `App.tsx` already dispatched a
    `codeblack:resume` event on Capacitor foreground but nothing listened for it, so those three
    sources could sit stale for their full poll interval after the tablet was backgrounded;
    telemetry already self-healed correctly via `setPaused`, this brings the rest in line.
    Hardened `ErrorBoundary` to auto-reload after an 8s countdown (with a crash-loop guard) instead
    of requiring someone to reach over and tap a button — appropriate for a dashboard mounted in a
    moving vehicle.
29. **BLE telemetry bridge to the Pi** — see "The Raspberry Pi backend" section above for the full
    writeup. Summary: the Pi already had a live, tested BLE peripheral
    (`codeblack-ble.service`/`codeblack_ble/server.py`) that nothing on the tablet consumed. Built
    `src/services/telemetry/ble-client.ts` and wired it into `api-provider.ts` as the *primary*
    Pi link (HTTP stays as fallback). Verified end-to-end on real hardware: PI LINK indicator went
    green, Wind/Location cards populated from the Pi's data, fragment reassembly confirmed correct
    for a real 6-frame/435-byte payload.
30. **BLE battery-drain fix** — the reconnect loop from item 29 had no backoff (10s active scan
    every 5s, forever, whenever the Pi was unreachable, including while backgrounded) — flagged
    after a same-day battery-drain report and fixed with exponential backoff (5s -> 90s cap) plus
    pausing BLE entirely on Capacitor background. Not fully attributable as *the* original cause
    (drain onset predated this code), but a real, confirmed problem in code from this session
    regardless. A longer idle `dumpsys batterystats` check is still owed.
31. **BLE command channel locked down + wired to real features** — see "The Raspberry Pi backend"
    section above. Token auth, strict allowlist, rate limiting, and an audit log on the Pi side
    (`codeblack_ble/server.py`); `sendCommand()` + a new Interior Lighting Settings panel on the
    tablet side. Found and fixed a Pi-side bug along the way (`/run/codeblack` permissions) that
    had been silently breaking lighting control Pi-wide, not just over BLE.
32. **Severe-flash overlay + Night Vision mode**: `SevereFlashOverlay.tsx` — a brief (5s or tap-to-
    dismiss) full-screen red pulse with the alert headline whenever `useAlertProducts` detects a
    new tornado/PDS warning in the GPS-scoped feed, alongside the existing audio tone. Night Vision
    — a new Display-panel toggle applying a CSS filter chain (`grayscale -> sepia -> hue-rotate ->
    saturate -> brightness`) across the whole app root to dim everything toward deep red/black for
    night chases; verified live on-device (screenshot confirms the full-app tint).
33. **Critical Settings page bug found and fixed**: `.page-grid--settings` was hand-written for 4
    panels and silently grew to 9 over several sessions — the first 4 panels (Display, Alerts, Pi
    Connection, Spotter Network) were rendering at **zero height and were completely inaccessible**
    (not just visually broken — Cockpit Mode, Night Vision, Audible Alerts, and Spotter Network
    sign-in/out were all unreachable). See "Established conventions" above for the root cause and
    the general pattern to watch for elsewhere. Confirmed fixed: all 9 panels now render and
    function correctly on-device.
34. **App-wide bug/design evaluation** — full sweep of Weather (both cockpit modes), Operations,
    Locate, Alerts, Report, Settings via live device screenshots. Found and fixed one real bug:
    `.map-controls button.active` (line ~5477 in `index.css`) had `background: rgba(255, 47, 64,
    0.18)` — 82% transparent, *more* see-through than a resting-state button's `rgba(3, 5, 7,
    0.78)`. On the Situational Map this let map road lines bleed straight through the highlighted
    MSC/LYR buttons, most visible as a stray diagonal line crossing the button stack. Fixed to
    `rgba(34, 4, 6, 0.9)` — matches the existing `:active` tap-state color family, stays opaque.
    Verified via on-device zoomed screenshot before/after. Also confirmed `.page-grid--operations`
    (flagged as unaudited in pending item #18) does NOT exhibit the Settings zero-height bug —
    `PiEndpointPanel` renders correctly in an auto-placed implicit row. One design inconsistency
    found and deliberately NOT auto-fixed, flagged for the owner instead: Weather Observations
    panel shows pressure in `inHg` (converted via `mbToInHg()`) in Chase mode but raw `mb` in Normal
    mode (`Panels.tsx` lines ~79-113) — confirmed via source read this is two intentional, separate
    render branches, not an accidental bug, so left as a question rather than silently changed.
35. **Animated splash/loading screen** — new `src/components/SplashScreen.tsx`, wired into
    `main.tsx` via a `RootWithSplash` wrapper that mounts the real `App` underneath immediately (so
    data fetching starts right away) while the splash overlays on top and self-dismisses — cosmetic
    only, never gates real app readiness. Sequence: shield logo scales/glows in with a rotating
    radar-sweep ring behind it, "CODE BLACK OPS" wordmark and tagline rise in, then a boot-message
    line (`LINKING TELEMETRY` -> `CALIBRATING RADAR` -> `SITUATIONAL AWARENESS ONLINE`) cycles above
    a filling progress bar. Auto-dismisses at 2.5s, tap-anywhere-to-skip at any time, exits with a
    380ms fade+scale. Respects `prefers-reduced-motion` (skips to a static 500ms showing, no
    animation). Base background color (`#070707`) intentionally matches
    `capacitor.config.ts`'s `SplashScreen.backgroundColor` so there's no color-shift handoff from
    Android's native launch splash. Skipped entirely for the debug `VITE_RECON_SCREEN=atlas-gl`
    path. Verified via a burst of on-device screenshots timed across the launch sequence (native
    splash -> mid-animation -> fully assembled state with all elements visible -> dashboard).

All of the above (items 1-35) were built, `npm run build` typechecked clean, and have now been
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
   The dead legacy `.wind-panel`/`.wind-compass` CSS purge flagged here is also DONE (Recent Work
   #27) — nothing left open on this item.
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
14. **Wide-area mosaic tile layer, animated loop** — DONE (see Recent Work #24, #25): static layer
    plus the play-3x/hold-20s/repeat animation the owner asked for right after. Toggle, z-order,
    maxzoom-survives-frame-swap, and the loop/wrap/hold timing are all confirmed correct (the loop
    mechanics via `adb logcat`, everything else via device screenshots). The one thing still
    unconfirmed is whether real colored precipitation actually renders right in the tiles
    themselves — no precip in range on the day this was tested. Worth a quick visual recheck next
    time there's real rain/storms anywhere in the national coverage area.
15. **Single-site radar mode needs a fine-tuning pass** — owner's own words, right after the mosaic
    work: "not fully happy with it yet." No specifics given yet on what's wrong with it — this
    needs a follow-up conversation to scope (typography? color scale? controls? something else?)
    before touching it, rather than guessing. Owner explicitly said to leave this for later.
16. **Map overlays** — DONE (see Recent Work #26): warning/MD polygons, plus a Team/Chaser pin
    system that grew bigger than originally scoped (personalizable color/shape, Settings-managed
    team roster) per the owner's requests mid-build. End-to-end verified on-device with real data.
    Still open: confirming polygons actually render correctly against a real active alert (no
    precip/warnings on the day this was tested), and the owner's own future plan to replace the
    Team roster's Spotter-Network-filter fallback with a real Pi/ESP32-based position feed once
    that infrastructure exists — not asked for yet, don't build until requested.
17. **BLE bridge to the Pi** — DONE (see Recent Work #29-31): telemetry, lighting control, and a
    locked-down command channel all verified live against real hardware. Still open: tablet-side
    UI buttons for `start_chase_session`/`end_chase_session`/`set_storm_mode` (the commands work,
    nothing calls them yet besides Interior Lighting's own controls); pairing/trusted-device policy
    beyond the shared token; a longer `dumpsys batterystats` idle check to properly confirm the
    backoff fix (item #30) resolved the drain report, not just that it fixed a real bug in
    isolation.
18. **Audit other `.page-grid--*` variants for the same fixed-row-count bug** that broke Settings
    (item #33) — DONE (see Recent Work #34): `.page-grid--operations` checked and confirmed NOT
    affected, `PiEndpointPanel` renders correctly. No other `.page-grid--*` variant has this many
    panels, so nothing else needs the same check right now — but re-check any page-grid before
    adding more panels to it, per the "Established conventions" writeup above.
19. **Ryan's Spotter Network info** — owner brought this up, then said "forget it, I misunderstood."
    Nothing to do here; not a real pending item, just documented so a future session doesn't assume
    it's still owed.
20. **Pressure unit inconsistency, flagged not fixed** (see Recent Work #34) — Weather Observations
    shows `inHg` in Chase mode, raw `mb` in Normal mode. Deliberate separate code paths, not a bug.
    Ask the owner whether this should be unified (and to which unit) before touching it.
21. **iPad-worthy splash isn't a stand-in for a real loading gate** — the new animated splash
    (Recent Work #35) is purely cosmetic and always dismisses on its own timer; it does NOT wait for
    GPS fix, Pi/BLE connection, or first telemetry poll. If the owner later wants the splash to
    reflect real startup progress (e.g. hold on "LINKING TELEMETRY" until BLE actually connects)
    that's a deliberate follow-up, not a bug — not built that way now on purpose, to avoid ever
    blocking the dashboard behind a flaky connection.
