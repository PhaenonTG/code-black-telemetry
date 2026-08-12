# Code Black Telemetry — Changelog

All changes logged newest-first.

---

## AltStore Source "Not Valid JSON" Fix, Attempt 2 - 2026-08-12

### Investigated
- Confirmed via a live on-device Safari load (user-provided screenshot) that the raw file reaching
  the phone is byte-for-byte the fixed content from attempt 1 below -- ruling out network
  interference, a stale CDN cache, or a wrong/mistyped source URL. The failure is genuinely inside
  AltStore's own parsing of an otherwise syntactically valid file.
- Checked this repo's git history: `appPermissions` has been present in `altstore-source.json`
  since the very first commit that created it, and nothing in this repo's history shows anyone ever
  successfully completing "Add Source" in AltStore with this file -- the earlier "debugged through
  many rounds" work was entirely about the Codemagic build pipeline (VerificationError 4, GitHub
  auth, etc.), not this in-app step. Unlike every other field in the file (`name`,
  `bundleIdentifier`, `iconURL`, `versions`, etc., all well-established AltStore source fields),
  `appPermissions` is the one part of this schema that was never independently confirmed against a
  real AltStore install.

### Fixed
- Removed `apps[0].appPermissions` entirely from `altstore-source.json` (attempt 1 changed its
  `privacy` value from `{}` to `[]`, which did not fix the error -- ruling out that specific type
  mismatch as the cause, though the array shape is still probably correct in principle). Also
  removed the corresponding `jq` clause in `codemagic.yaml`'s publish step so future auto-published
  builds don't reintroduce the field.

### Not Done / Needs Follow-up
- Still not confirmed against AltStore's actual Swift source model (no network access to AltStore's
  docs or source repo from this session, and this repo has no self-hosted copy of the real schema)
  -- this is a diagnostic-by-elimination fix (drop the one unverified field), not a confirmed root
  cause. If "Add Source" still fails after this, the next step is trimming the file down to the
  handful of fields every real-world AltStore source is confirmed to use and rebuilding up from
  there field-by-field with on-device verification each time.

---

## Full App UI Polish Pass - 2026-08-11

Refined page spacing, dock sizing, and tablet/phone layout behavior after a full rendered review.

### Changed
- Tightened the bottom dock so it stays anchored to the real bottom edge with less wasted height.
- Removed dashboard page-dot controls from the fixed dashboard layout after reverting the movable
  card experiment.
- Improved Alerts page readability with stronger summary cards, clearer full alert text, and better
  portrait/landscape scrolling behavior.
- Refined Report page density so the submission panel and nearby report feed share space more cleanly.
- Improved Layers page rows so labels, toggles, and pin controls do not collide on phone layouts.
- Reduced Settings page crowding on tablet landscape and made Settings scroll cleanly when content
  exceeds the viewport.
- Added short-landscape dock behavior so phone landscape labels no longer clip at the bottom edge.

### Preserved
- Weather telemetry, BLE/Pi status, radar/maps, alerts data, report feed behavior, stream controls,
  and Android Auto vehicle-display plumbing were not changed.

### Validation
- `npm run lint` passes with existing warnings.
- `npm run build` passes with the existing Mapbox chunk-size warning.
- Render checks were captured across tablet landscape, phone portrait, and short landscape viewports.

---

## Vehicle Display Snapshot and Android Auto Weather Surface - 2026-08-11

Added a read-only vehicle display data path for Android Auto and the future CarPlay Live Activity/widget surface.

### Changed
- Added a shared vehicle-display snapshot published by the main app with nearest city/state,
  conditions, wind, and update age.
- Added an Android Auto Weather app service that reads that snapshot and presents current
  location, conditions, wind, and snapshot age in a car-safe template.
- Added Android Auto `weather` category metadata and the AndroidX Car App dependency.
- Documented the intended CarPlay implementation as a WidgetKit/ActivityKit Live Activity surface,
  not a full custom CarPlay dashboard.

### Preserved
- Main tablet dashboard behavior, radar, alerts, reports, BLE/Pi telemetry, and stream controls
  were not changed.

### Validation
- `npm run lint`, `npm run build`, `npx cap sync android`, and Android `assembleDebug` pass.

---

## Spotter Network Reports and Feed Settings - 2026-08-11

Added Spotter Network reports to the nearby report feed and made feed range configurable.

### Changed
- Refined the Report page feed with source filters, source counts, latest/nearest report summary
  cards, and visible source badges on each report row.
- Added the public Spotter Network reports-only feed alongside NWS Local Storm Reports on the
  Report page.
- Added Settings controls for report-feed radius and retention so nearby reports can be tuned
  separately from nearby chaser pins.
- Added a 24-hour retention quick option on the Report page and distinct Spotter Network row
  styling in the feed.
- Fixed phone portrait Settings layout so the added Report Feed controls render as readable
  full-width panels instead of squeezed desktop columns.

### Preserved
- Existing Spotter Network report submission/sign-in behavior remains unchanged.
- NWS Local Storm Reports remain in the same feed.
- Weather, radar, alerts, maps, Operations, BLE/Pi telemetry, and stream controls were not changed.

---

## Nearby Report Feed - 2026-08-11

Added a live nearby Local Storm Reports feed to the Report page.

### Changed
- Split the Report page into a report submission panel and a nearby report feed panel.
- Added NOAA/NWS Local Storm Reports polling from the official 24-hour MapServer layer.
- Filtered reports by exact distance from current GPS and by a selectable retention window.
- Added quick controls for 10/25/50/100 mile radius and 1/3/6/12 hour feed retention.
- Kept the feed available even when Spotter Network sign-in is missing; submission still requires
  Spotter Network as before.

### Preserved
- Existing Spotter Network report submission fields and validation remain intact.
- Weather, radar, alerts, maps, Operations, BLE/Pi telemetry, and stream controls were not changed.

---

## UI Polish and Alert Tone Pass - 2026-08-11

Tightened the fixed dashboard layout and alert feedback after phone/tablet review.

### Changed
- Refined phone Weather scaling, header density, bottom dock height, and card ordering so location,
  wind, alerts, conditions, and map content fit more naturally on small screens.
- Tightened tablet/landscape Weather cards so Location & Motion text no longer collides and
  Conditions/Alerts use their card space more evenly.
- Collapsed the long Operations radar diagnostic wall behind a Show/Hide Diagnostics control while
  preserving the native radar engine details.
- Added a direct Spotter Settings action from the signed-out report page.
- Split alert audio into distinct Severe, Tornado, and PDS warning tones, with Settings test buttons
  for each.

### Preserved
- Fixed dashboard cards remain fixed; no movable/sliding/card-ordering behavior was reintroduced.
- Radar/maps, BLE telemetry, Pi HTTP fallback, alerts, reporting, streaming controls, and KNWA/Code
  Black stream controls remain in place.

---

## First-Run Prompt and BLE Pairing Hardening - 2026-08-11

Hardened two first-run/device-test annoyances before pushing the mobile layout fixes.

### Changed
- Made the Spotter Network first-run prompt persist its dismissed state before closing, with a
  local fallback so a failed native Preferences write cannot trap the user behind the modal.
- Fixed a telemetry-link startup race where BLE could briefly start before the saved On/Off setting
  finished loading.
- Added BLE pairing/auth/cancel failure cooldown so the app does not immediately keep re-triggering
  OS pairing prompts after a rejected or canceled pairing flow.

### Preserved
- Spotter sign-in remains optional and still available from Settings.
- BLE telemetry remains enabled when the Pi/ESP link setting is On; this only reduces unwanted
  repeated prompts and startup races.

---

## Tablet Bottom Dock Refinement - 2026-08-11

Refined the iPad/tablet bottom navigation after the phone dock pass so the tab bar sits flush to
the physical bottom of the screen and uses shorter, denser controls.

### Changed
- Added tablet-specific dock sizing and safe-area handling for portrait and landscape viewports.
- Removed the tablet shell's visual bottom gap by letting the dock row own the bottom inset.
- Kept all seven navigation buttons evenly distributed with single-line labels.

### Preserved
- Weather dashboard card layout, radar/maps, Operations, telemetry, alerts, reporting, and stream
  controls were not changed.

---

## Mobile Dashboard Density Pass - 2026-08-11

Tightened the restored fixed Weather dashboard for phone layouts after device screenshots showed the
header and bottom dock consuming too much space on narrow screens.

### Changed
- Reduced the mobile bottom dock height, pinned it to the safe-area bottom, and shortened narrow
  phone labels where needed.
- Added narrow-phone header overrides so the Code Black OPS brand, time, Pi link, and battery fit
  around camera cutouts/notches.
- Compressed Weather dashboard card spacing, title bars, metric tiles, wind/alert/location panels,
  and conditions content on portrait phones while keeping the fixed dashboard layout.

### Preserved
- No movable, draggable, swipeable, or carousel-style dashboard cards were reintroduced.
- Radar, navigation, Operations, BLE/Pi telemetry, alerts, reporting, and stream controls were left
  untouched.

---

## Revert Movable Dashboard Cards - 2026-08-10

Restored the Weather dashboard to the fixed card layout at user request, removing the experimental
movable/resizable dashboard-card UI without rolling back later radar, maps, alerts, BLE, Pi, report,
streaming, or networking work.

### Changed
- Removed the mounted Weather-grid splitter controls from `src/App.tsx`.
- Deleted the unused splitter component/hook pair (`WeatherGridSplitters.tsx`, `useGridSplitter.ts`).
- Removed the Weather layout reset control from Settings and the persisted Weather-grid layout
  preference API from `src/services/settings.ts`.
- Converted the remaining Weather dashboard CSS back to fixed hardcoded grid tracks/areas and
  removed the splitter handle styles/comments.

### Preserved
- Wide-area mosaic radar default, Locate map behavior, range rings, camera/zoom/pan/follow mode,
  Operations radar diagnostics, Pi/BLE telemetry controls, alerts, reporting, streaming controls,
  and the current AltStore/Codemagic publish flow were left intact.

---

## Wide-Area Mosaic as Default Radar (iOS Parity) - 2026-08-08

Direct follow-up to the "Radar-on-iOS Investigation" pass below, per explicit direction: rather
than build native iOS single-site radar (blocked on Mac/Xcode access this session doesn't have),
make the wide-area mosaic layer -- already implemented, already zero-native-dependency -- the
default radar view everywhere. It renders identically on Android and iOS today since it's a plain
Mapbox GL raster source hitting a public HTTP tile endpoint, no Capacitor plugin involved.

### Changed
- `src/components/situational/Panels.tsx` -- `AtlasMapRadarPanel` (Weather-page compact card and
  Locate-page full map both route through this) no longer drives single-site product/site/frame/
  playback state. It now passes `frame={null}` and an inert `product="REF"` to `AtlasMap`, with
  static status lines (`MOSAIC / NEXRAD N0Q COMPOSITE / LIVE`) -- the mosaic layer
  (`AtlasMosaicLayer.ts`) is independently always-on via `layerVisibility.mosaic` and is now the
  only radar imagery this view renders.
- `RadarExpandedView` (the full-screen map modal) simplified to match: header now reads "Wide-Area
  Mosaic / NEXRAD N0Q Composite Reflectivity - CONUS / LIVE", with only range-ring controls and
  updated help text remaining. Removed product tabs, loop/scrub controls, tilt display, site
  selector, and the storm-motion form from this view -- they were all single-site-product controls
  with nothing left to control here.
- Removed now-dead code from the same file: `defaultRadarOpacity()`, the single-site frame/
  playback/site-selection state machine, and unused imports (`useMemo`, `ageText`,
  `getNearestRadarSites`, `getRadarFrames`, `getRadarStatus`, `setRadarStormMotion`, the
  `RadarFrame`/`RadarProduct`/`RadarSite`/`RadarStatus`/`RadarPlaybackSpeed` types, the
  `buildFrameSeries`/`nextHistoricalIndex`/`nextPlaybackIndex`/`playbackDelayMs`/
  `previousHistoricalIndex`/`writeRadarLoopDiagnostics` helpers from `radarLoop`, and the local
  `localTime()` helper).
- Removed the CSS that only styled that now-deleted UI from `src/index.css`: `.atlas-product-mini`
  (self-contained block), `.radar-loop-control`/`.radar-loop-speed` (self-contained block), and
  `.radar-product-tabs`/`.srv-motion-control` (surgically removed from 3 shared selector lists,
  leaving the still-used siblings -- `.radar-expanded__controls button`, `.storm-motion-form
  input`, etc. -- untouched). Confirmed zero remaining references with a full-source grep before
  and after. Production CSS bundle shrank ~1.2 kB as a result.
- `src/components/situational/LayerConfigPage.tsx` -- fixed stale mosaic layer description that
  called it "animated on a loop" (leftover copy from a removed RainViewer-based implementation).
  Now correctly describes it as auto-refreshing composite reflectivity and the default live view.

### Preserved (explicit user requirement: "keep the zoom and movement stuff in place")
- Camera/zoom/pan/follow-mode logic in `AtlasCameraController.ts` is untouched -- it was already
  confirmed independent of which radar layer is active, and nothing in this pass touched it.
- Range-ring controls preserved in both the compact and expanded map views.
- Android on-device single-site decoding (REF/VEL/SRV/CC via the Rust/JNI native plugin) is fully
  intact and unaffected: `services/radar.ts`, the Android native plugin, and the Operations page's
  Radar Engine diagnostics card (`RadarEndpointPanel.tsx`, including its storm-motion-override
  form) still exist and still work where the native decoder is present. This pass only changes
  what the map *shows by default* -- it does not remove or disable the underlying capability.

### Not Done / Needs Follow-up
- This is a UI-default change, not a permanent architectural decision -- if/when native iOS
  single-site radar gets built (see the investigation entry below for what that requires), the
  product tabs/loop UI that was removed here would need to be reintroduced or redesigned to cover
  both platforms consistently.
- Not visually verified on a physical device or simulator (no Mac/Xcode/physical device in this
  session) -- verified via `npm run lint`, `npm run build` (`tsc -b` + `vite build`, catches unused
  imports since `noUnusedLocals: true`), and `npx cap sync android` only. Needs a real look on both
  platforms before calling it done-done.

---

## Radar-on-iOS Investigation + CSS Cascade Cleanup - 2026-08-08

### Investigated: Radar on iOS -- confirmed genuinely unimplemented, not fixed this pass

- Verified the full current architecture: `src/services/radar.ts` talks to exactly one Capacitor
  plugin, `RadarNative`. Android's implementation
  (`android/app/src/main/java/.../radar/RadarNativePlugin.java`) loads a Rust `.so`
  (`libcodeblack_radar.so`) via JNI. **iOS has zero implementation** -- no Swift plugin file, no
  stub, no TODO, nothing in `ios/App/` mentions radar at all. The Rust core itself
  (`native/radar-ref/`) is hard-coupled to Android: `crate-type = ["cdylib"]`, links the `jni`
  crate directly, only targets `aarch64-linux-android` -- no iOS target exists anywhere in the repo
  (`.cargo/config.toml`, `cargo lipo`, `aarch64-apple-ios`: zero matches).
- **Not fixed, and not attempted as a blind implementation.** Real iOS radar support means
  cross-compiling the Rust core for iOS (restructuring away from JNI-specific APIs to a C-ABI/
  XCFramework target) plus writing a full Swift Capacitor plugin implementing all 14 methods the
  Android plugin does -- work that can only be compiled and tested on an actual Mac with Xcode,
  neither of which exist in this session. Writing that code without any way to compile or test it
  would produce something that looks like a fix without being verifiably one.
- **The one genuinely good finding**: iOS doesn't crash or fabricate data today. `radar.ts`'s
  native calls are wrapped in try/catch (originally written for Android's own failure cases), so
  the missing iOS plugin call gets caught and gracefully degrades to an honest "ON-DEVICE RADAR
  DECODER NOT INSTALLED" status with no frames -- not a crash, not a hang, not fake data. Combined
  with the RadarEndpointPanel fabrication fix above, this now displays honestly end-to-end on iOS.
- This needs to be scoped and built as its own dedicated effort by whoever has Mac/Xcode access,
  not attempted piecemeal.

### Fixed -- confirmed CSS cascade bugs (not guesses)

- `.map-status`'s styling was split across 5 separate unscoped base-rule blocks scattered through
  `index.css` (not the 3 an earlier pass estimated -- a direct grep found 5), each partially
  overriding the previous one's position/z-index/color/font. One of the 5 blocks was **fully dead**
  (every property it set was unconditionally overridden by a later block) -- deleted it. A separate
  single-property `z-index: 8` rule (shared with 3 other selectors) was also fully dead specifically
  for `.map-status` (overridden twice more later to `4` then `2`) -- removed `.map-status` from
  that selector list, left the rule intact for the other 3 selectors it still legitimately applies to.
- Left the remaining `.map-status` font-size override (10px, overriding an earlier 14px `font`
  shorthand) as-is after checking: the same 3 remaining blocks show a consistent pattern of
  deliberately refining position/z-index/size together across multiple passes (10px→14px→12px for
  left, 8→4→2 for z-index, etc.) -- this reads as intentional iteration, not an accidental clobber,
  so I didn't guess at changing it without visual confirmation.

### CSS responsive architecture -- audited, foundation is actually sound

- Confirmed the landscape/portrait split is mathematically exhaustive: `(orientation: landscape)`
  and `(max-aspect-ratio: 13/10)` together cover every possible device orientation by CSS spec
  definition (any portrait device has aspect-ratio &lt; 1 &le; 1.3). Both "single source of truth"
  grid blocks (100-column `fr`-based landscape grid, single-column portrait stack) use **no
  hardcoded pixel minimums** -- they should scale cleanly from small tablets through ultrawide
  monitors, and from phone-portrait through iPad-portrait, in principle.
- Found the `(orientation: landscape)` condition alone is still duplicated across 9 separate
  `@media` blocks (1,469 to 6,853 in the file), plus 3 separate unscoped base `.bottom-dock` rule
  blocks, plus several other duplicate/conflicting declarations (`.alert-pill span`/`.metric-tile i`
  font-size conflicts, `.metric-grid` gap/padding duplicates) not yet consolidated -- noted below,
  not all fixed this pass given the size of the surface area.

### Not Done / Needs Follow-up
- **"Looks sharp on every device" cannot be fully guaranteed from this session.** The architectural
  foundation is confirmed sound (exhaustive orientation coverage, no hardcoded overflow-causing
  minimums in the live rules), and several concrete cascade bugs were fixed, but genuinely verifying
  polish across real device sizes requires actually seeing it render on more than one physical
  device/simulator -- something this cloud session cannot do. Treat this pass as "fixed what's
  provably broken by code inspection," not "visually verified across screen sizes."
- Remaining duplicate/conflicting declarations noted above (`.alert-pill`, `.metric-tile i`,
  `.metric-grid`, the 9x-duplicated `(orientation: landscape)` condition, 3x duplicated
  `.bottom-dock` base rules) -- not consolidated this pass, same effort-vs-blind-visual-risk
  tradeoff as other deferred cleanup this session.
- `.dock-signature` CSS (13 references across the file) confirmed 100% dead -- zero JSX references
  anywhere -- but not removed this pass; it's inert either way so lower priority than the fixes above.

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
