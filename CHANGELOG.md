# Code Black Telemetry — Changelog

All changes logged newest-first.

---

## Operations Page Fixes - 2026-08-08 - Radar Status Fabrication, Grid Fragility, Empty States

### Fixed
- **Data fabrication (direct rule violation, highest priority)**: `RadarEndpointPanel.tsx`'s "Radar Engine" card hardcoded REF/VEL/SRV/CC to the literal string `"AVAILABLE"` unconditionally, regardless of the actual decoder state -- even while the on-device radar engine had never initialized or was in a `DECODER_NOT_INSTALLED` state. The real data (`RadarStatus.availableProducts`) already existed and was simply never read. Now shows `"--"` (unknown, before first status fetch), `"AVAILABLE"`, or `"UNAVAILABLE"` based on the real value. Same bug in `App.tsx`'s Diagnostics panel, which separately hardcoded "Radar Engine: ON DEVICE" -- removed that line entirely rather than plumbing a second live data path, since `RadarEndpointPanel` already shows this correctly and the two were at risk of visibly contradicting each other (one hardcoded-always-on-device, one correctly conditional) two panels apart on the same page.
- 4 Operations-page panel titles (`RadarEndpointPanel`, `PiEndpointPanel`, and the two hand-rolled sections in `App.tsx` -- "Operational Mode" and "Diagnostics") were missing the `panel-glyph` span every `DashCard`/`Panel`-based title renders -- a visible inconsistency (no glyph before those 4 titles specifically). Added.
- `SensorHealthCard`/`SystemCard`/`PowerCard` were positioned in the Operations grid via `:nth-child(2)`/`:nth-child(3)`/`:nth-child(4)` -- "whichever `.cb-panel` happens to be the Nth DOM child" -- so reordering `App.tsx`'s Operations section, or inserting any new panel before these three, would silently move cards into the wrong grid cell with no compile-time or visual warning until it happened. Replaced with named classes (`SensorHealthCard` didn't have one at all; `ops-system-panel`/`ops-power-panel` already existed on `SystemCard`/`PowerCard` for unrelated overflow styling and are now reused for placement too).
- `SensorHealthCard` (zero sensors) and `EventsCard` (zero events) rendered a blank interior with no explanation when their data arrays were empty -- added `"NO SENSORS REPORTED"`/`"NO RECENT EVENTS"` empty states, matching the `.calm-card` pattern already used for this on Page 1.
- `EventsCard`'s `[ERR ]` log-level tag used a hardcoded trailing space baked into the string literal to visually pad it to the same width as `[INFO]`/`[WARN]` -- replaced with `.padEnd(4)` applied consistently to all three tags.

### Not Done / Needs Follow-up (noted, not attempted this pass)
- Operations page has 4 different, incompatible "shared primitive" patterns in play (`DashCard`/`MetricRow`, `Panel` alone, hand-rolled `cb-panel` sections, and inline JSX in `App.tsx`) -- worse fragmentation than Page 1's `Panel`/`MetricTile` split found earlier. Not unified this pass; a real architectural decision (which pattern becomes canonical, applied app-wide) rather than a quick fix.
- `.cb-panel`/`.cb-panel::before`/`.cb-panel--red`/`.cb-panel--spc` are each defined 2-3 times across scattered `index.css` blocks (same duplication pattern found and partially cleaned up elsewhere this session); `.diagnostic-grid` has 7+ separate rule sites; the Operations grid's mobile-collapse block is byte-for-byte duplicated across 3 separate `@media` blocks. Not consolidated this pass.
- Blank-hole loading state (`if (!x) return null`) on all 4 `src/components/cards/` components while telemetry is still cold-starting -- no skeleton/placeholder shown, just an empty grid cell until the first snapshot arrives.
- No physical-device screenshot validation for any of the above.

---

## Cleanup Pass - 2026-08-08 - Capacitor Version Fix, AltStore File Sprawl, Dead CSS Class

### Fixed
- `@capacitor/core`/`@capacitor/android` version mismatch (core was resolving to 8.5.0 via `@capacitor/ios`'s own `^8.5.0` requirement while android stayed pinned to 8.4.2) -- bumped android to `^8.5.0` to match, rather than pinning core down (which would have broken the iOS plugin's requirement -- not an option now that AltStore builds actually work).
- Consolidated 3 AltStore manifests down to the 1 the Codemagic pipeline actually maintains (`altstore-source.json`). `altstore-source-v2.json` was a byte-identical duplicate under a different self-referencing URL; `altstore-source-min.json` was a one-off manual diagnostic file never wired into the automated pipeline. Also removed a genuinely wasteful step from `codemagic.yaml`: it was still creating a GitHub Release and uploading the `.ipa` there every build, left over from before `downloadURL` moved to the git-committed `altstore/` path -- the release was created but nothing ever referenced it. Removed 4 stale/unreferenced `.ipa` files from `altstore/`, and added a prune step so the directory stops accumulating one more `.ipa` per build forever.
- Renamed the internal CSS class `.threats-panel` to `.nearby-panel` across 4 grid-placement rules in `index.css` (traced each one's actual `@media` applicability the same way the earlier bottom-dock/row-split cascade tracing did) -- `NearbyPanel.tsx`'s JSX already carried `.nearby-panel` alongside it, so `.threats-panel` was a pure leftover from this card's "Storm Threats" predecessor. Also deleted 5 genuinely dead CSS rules (`.threats-panel .threat-card`/`.threat-list`/`.view-all-button`) confirmed to match zero elements.

### Investigated, Confirmed Intentional (Not Changed)
- Map card in-chrome status line: `compact` mode (Page 1's map rendering) is an explicit owner decision to show "mosaic + layer visibility only... no single-site radar UI at all" (comment in `AtlasMap.tsx`), and the mosaic layer doesn't expose freshness data to hook into anyway. Not a gap -- implementing this would override a deliberate simplification.

### Not Done / Needs Follow-up
- Operations page (Page 2) design-consistency audit is in progress as of this entry -- see the next changelog entry once it lands.
- No physical-device screenshot validation for any of the above -- this pass ran in a cloud session with no ADB/physical-tablet access.

---

## Alerts Detail/Countdown + Card Consistency Pass - 2026-08-08 - Live Expiration Countdown, Alert Wording, SourceBadge/Precision Fixes

### Added
- Alerts now show a live, ticking expiration countdown ("Expires in 23 min") instead of a static raw timestamp string. Extracted the countdown logic (previously private to the map's alert popup) into `timeRemainingText()` in `src/services/situational.ts` so the map popup, Alerts panels, and product detail modal all share one implementation. Built `src/hooks/useCountdown.ts` to make it tick live (30s interval) in React components.
- The full Alerts page now shows a truncated (3-line) preview of each product's real `description` text directly on its pill, not just the headline -- full untruncated text was already available via the detail modal, this surfaces it one tap earlier. Page 1's compact Alerts card intentionally stays headline-only to preserve glanceability.
- Extracted `AlertPill` as its own component (used by both the compact Page-1 card and the full Alerts page) so the countdown hook has a fixed call count per pill, not a variable one inside a `.map()` -- a real rules-of-hooks constraint, not just a style preference.
- Conditions card ("Weather Observations"/"Conditions") now has a `SourceBadge`, matching Location and Wind -- previously the only Page-1 telemetry card without one; source attribution was buried in a small footer string. The freshness state (`badgeState`) was already computed by `resolveWeatherWithFallback`, just never rendered as a badge.
- Location & Motion's chase-mode footer now shows a compact single-line coordinate readout -- previously chase mode dropped Lat/Lon/Fix entirely rather than showing a trimmed version (normal mode kept the full 3-tile breakdown). The CSS scaffolding for a flex chase-mode footer already existed and was unused.

### Fixed
- Conditions card showed temperature at 1-decimal precision in normal mode but 0-decimal in chase mode, for no functional reason -- standardized to 0 decimals in both.

### Not Done / Needs Follow-up
- Map card in-chrome status line (LIVE/CACHED + age): investigated, did not implement. `compact` mode (how the map renders on Page 1) deliberately skips all single-site radar status/frame fetching for performance -- there's no site freshness data available to show without either reintroducing that fetching or piping through wide-area-mosaic freshness data that isn't currently exposed anywhere accessible. Needs an actual design decision, not a styling change.
- Wind card's separate CSS file (`WindCard.css` vs. the monolithic `index.css` every other card uses) and its unique tap-to-reset interaction pattern: left as-is. Both are real, documented, intentional-for-now choices (the separate file works around specificity conflicts with stale `index.css` rules; the interaction pattern is unique to Wind and extending it elsewhere is a design decision, not a bug fix).
- `NearbyPanel` still carries the internal CSS class `.threats-panel` (grid-placement leftover from its "Storm Threats" predecessor). Confirmed purely cosmetic (zero visual/functional effect) and touches ~8-10 scattered grid-placement rules across breakpoints to rename -- skipped given the effort-to-benefit ratio, noted for a future cleanup pass.
- Full `MetricTile` migration for Wind/Alerts/Map/Nearby (currently hand-rolled markup each): not attempted this pass -- a bigger visual restructuring of each card's internals than the more surgical fixes above, and not verifiable without physical-device screenshots.
- `AlertsPanel`'s "View All Alerts" `window.dispatchEvent` navigation: re-investigated and confirmed this is the *correct*, deliberate pattern (not a bug) -- the map's non-React alert popup needs the same global event bus since it has no React tree access, and `App.tsx` already listens for it consistently. Not changed.
- No physical-device screenshot validation for any of the above -- this pass ran in a cloud session with no ADB/physical-tablet access.

---

## Weather Page Polish + Map Pin Customization - 2026-08-08 - Moveable Cards, Bottom Dock, POI Icons, Color Wheel

### Added
- Mounted `<WeatherGridSplitters />` in `App.tsx` -- the drag-to-resize feature for the Weather page's 6-card grid was fully implemented (drag hook, Capacitor Preferences persistence, clamping, matching CSS custom properties) but was never actually rendered anywhere, so it had no visible handles and nothing was draggable despite existing in the codebase.
- Decoupled the Weather grid's two rows' column splits: `WeatherGridLayout` now has independent `row1ColSplitLeft/Right` (Location/Conditions/Wind) and `row2ColSplitLeft/Right` (Alerts/Map/Nearby) instead of one shared pair that moved both rows together. Stays percentage-based, so sizing still scales with viewport rather than fixed pixels.
- Built `src/components/map/ColorWheel.tsx` -- a dependency-free HSV color wheel (hue ring + saturation/value square + hex field), replacing the native `<input type="color">` + fixed 8-swatch preset row in `PinStyleEditor.tsx` (Team/Chaser/Vehicle pin styling) and the plain color input in `LayerConfigPage.tsx`'s Custom Pins row. Full hue range, including blue, which the previous preset palette deliberately excluded.
- Added 4 hand-authored POI category icons (`src/assets/poi-icons/`: fuel pump, bed, medical cross, fork+knife) replacing the single-letter (G/H/F/ER) map pin labels in `AtlasPoiLayer.ts` for gas/lodging/food/hospital nearby pins. Kept the existing colored-rounded-square treatment per category, just swapped the glyph.

### Fixed
- `src/index.css` bottom-dock nav: 3 separate `.bottom-dock { grid-template-columns }` rules (across different `@media (orientation: landscape)` blocks, one unconditional and last-in-file) were still hardcoded to `repeat(5, ...)` or `repeat(6, ...) + a signature slot`, left over from before the dock grew to its current 7 real buttons and `.dock-signature` stopped being a distinct corner element. Traced the actual cascade (not just source order) against the 1920x1200 landscape viewport to find which of ~15 overlapping `.bottom-dock` rule blocks genuinely wins, and fixed the ones that do.

### Not Done / Needs Follow-up
- No physical-device screenshot validation for any of the above -- this pass ran in a cloud session with no ADB/physical-tablet access. Per project QA practice, none of this should be considered accepted until built, installed, and visually confirmed on the real Samsung tablet.
- POI icon SVGs are hand-drawn geometric silhouettes (no visual preview available while authoring) -- likely need an on-device look and possible refinement; they're plain static SVG files, easy to swap.
- Alerts page detail/wording + live expiration countdown, and the broader card-by-card design-consistency pass (SourceBadge/MetricTile usage across Wind/Alerts/Map/Nearby), were scoped and handed off as a separate prompt but not yet implemented in this pass.

---

## Streaming Controls - 2026-08-07 - Operations Mission Streaming Panel

### Added
- Added `MissionStreamingPanel` to the existing Operations page without changing navigation, map, radar, or global branding.
- Added `src/services/streaming.ts` as the tablet-side stream model/client boundary for camera, KNWA, Code Black, and recording status.
- Added compact KNWA, Code Black, and REC switches with visible state pills using the Pi state vocabulary: `OFF`, `STARTING`, `LIVE`, `DEGRADED`, `RECONNECTING`, `FAILED`.
- Added camera ingest status as a compact read-only row.

### Pi API / BLE Wiring
- Status reads use the Pi local stream API:
  - `GET /api/local/stream/status`
  - fallback individual reads for `/camera`, `/knwa`, `/code-black`, `/recording`
- Stream commands prefer BLE when connected:
  - `stream.knwa.start` / `stream.knwa.stop`
  - `stream.code_black.start` / `stream.code_black.stop`
  - `recording.start` / `recording.stop`
- If BLE is unavailable, commands fall back to the configured Pi HTTP endpoint:
  - `POST /api/local/stream/knwa/start|stop`
  - `POST /api/local/stream/code-black/start|stop`
  - `POST /api/local/stream/recording/start|stop`
- HTTP commands include the existing Code Black command token in `X-CodeBlack-Command-Token` and request body; no stream keys or destination credentials are stored or displayed on the tablet.

### Behavior
- Start taps show `STARTING` while the command is in flight, then reconcile from Pi status.
- Stop taps do not claim `OFF` until the Pi reports `OFF`.
- `DEGRADED` and `RECONNECTING` keep the switch logically on.
- Stale/unreachable stream status displays `UNKNOWN` instead of leaving stale `LIVE` visible.
- One command can be in flight at a time per panel interaction path; repeated taps are disabled while pending.

### Deferred
- No MediaMTX, FFmpeg, OBS, producer, Core ingest, stream-key, Pi networking, or mission PREP/LIVE implementation was added.
- Follow-ups remain: real DJI ingest test, KNWA credential/config verification, Code Black Core video ingest, detailed metrics, storage remaining time, producer go-live signaling, prioritize-KNWA/panic action, and automatic preflight checklist.

---

## Audit Pass - 2026-08-06 - Repository Review, Documentation, and Handoff

### Scope
- Performed a top-to-bottom audit of the current tablet repository before making changes.
- Reviewed frontend shell, pager navigation, service boundaries, BLE telemetry, HTTP fallback, settings persistence, map/radar systems, Android native plugins, permissions, prototype radar worker, scripts, docs, and validation surface.
- Confirmed that this pass did not authorize major UI, networking, streaming, schema, or architecture changes.

### Safe Changes Made
- Replaced stale Vite-template `README.md` with the current Code Black OPS tablet overview, command list, environment notes, and guardrails.
- Replaced stale Phase 1 `ARCHITECTURE.md` with the current seven-page pager, BLE-first telemetry, native Android radar, networking boundary, and native Android surface.
- Added sanitized `.env.example`.
- Added `docs/2026-08-06-audit-handoff.md` with findings, TODOs, streaming readiness, networking review, and approval-required items.
- Updated `PROJECT_STATE.md` to point future developers to the latest audit handoff.

### Significant Findings
- No confirmed critical runtime defect was changed during this pass.
- Android backup remains enabled while Capacitor Preferences can contain Spotter Network password and BLE command token; policy decision required before field/public hardening.
- Prototype Node radar worker is CORS-open, listens on all interfaces, and has unauthenticated POST controls; keep dev-only or harden with approval.
- Real Raspberry Pi NetworkManager/recovery AP/hotspot/watchdog/systemd topology is not present in this checkout and must be audited on the Pi-side codebase/live Pi.
- Nearby, POI, and spotter hooks avoid GPS jitter fetch storms but can keep using captured stale coordinates; recommended threshold/ref-based fix is deferred for approval.

### Streaming Readiness
- Documented future KNWA Stream and Code Black Stream state model: `OFF`, `STARTING`, `LIVE`, `DEGRADED`, `RECONNECTING`, `FAILED`.
- Recommended tablet remains control/status only, with Raspberry Pi owning ingest, FFmpeg/MediaMTX or equivalent, recording, reconnect, and stream health.
- Recommended Code Black Core owns overlays, producer/OBS workflow, remote production, distribution, and archival services.
- No streaming stack was implemented during this audit.

### Networking Findings
- Current tablet repo implements BLE primary telemetry/commands and optional HTTP Pi endpoint fallback.
- No NetworkManager, PiWX-Recovery, recovery AP, Starlink/phone hotspot priority, or systemd definitions are included here.
- Future onboard Wi-Fi / USB Wi-Fi WAN failover model needs Pi-side inspection and user approval before changes.

### Next Recommended Work
- Audit the actual Raspberry Pi repo and live network/service configuration.
- Approve and fix stale GPS refresh behavior for nearby/POI/spotters.
- Decide Android backup/credential storage policy.
- Define Pi stream status/control API contract before adding tablet controls.

---

## Phase 1.0.0 — 2026-06-27 — Foundation & Dashboard Architecture

**Initial build. Establishes the full Phase 1 foundation.**

### Project Setup
- Vite + React 19 + TypeScript scaffold
- Tailwind CSS v3 with Code Black color palette
- React Router v6 for page navigation
- Zustand for global telemetry state

### Telemetry Layer
- `TelemetryProvider` interface defined in `types.ts` — all UI reads through this contract
- `SimulatorProvider` generates realistic fake data with random walks:
  - Wind speed/gust/direction vary slowly each tick
  - GPS speed and heading update continuously
  - Battery voltage drifts gradually
  - CPU/RAM fluctuate with occasional spikes
  - Events log generated every ~30 seconds
- `src/services/telemetry/index.ts` is the designated swap point for connecting the Raspberry Pi

### Components
- `DashCard` — base panel with header bar, optional blue accent border
- `MetricRow` — label/value row with color-coded status (ok/warn/critical/muted)
- `StatusBadge` — online/offline indicator with optional pulse animation
- `TopBar` — brand, live clock, Pi connection status, vehicle ID, health indicator
- `StatusStrip` — API latency, data age, Pi status, CPU, RAM, battery voltage
- `BottomNav` — 6-tab bottom navigation with active state indicator

### Cards
- `WindCard` — speed, gust, direction, freshness
- `WeatherCard` — temperature, dewpoint, humidity
- `GpsCard` — speed, heading, satellites, fix status
- `SensorHealthCard` — nav-esp and wx-esp online status, packet rate, last seen
- `PowerCard` — main battery, aux battery, charging state
- `SystemCard` — CPU, RAM, storage, uptime
- `EventsCard` — scrollable timestamped event log with level coloring

### Pages
- `Dashboard` — 4-column overview grid with all primary cards
- `Wind` — detailed wind view with large speed and direction displays
- `Weather` — detailed weather with spread calculation
- `GPS` — detailed GPS with coordinates, heading, satellite count
- `System` — compute, power, sensor health, events combined view
- `Settings` — data source indicator, vehicle config, swap instructions

### Documentation
- `ARCHITECTURE.md` — folder structure, swap guide, provider interface, deployment targets

### Not Built (Phase 2+)
- Maps, Radar, OBD, Cameras, Chase Mode
- Raspberry Pi API/WebSocket providers
- Android APK packaging
- Real ESP32 telemetry ingestion
