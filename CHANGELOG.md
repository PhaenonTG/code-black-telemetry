# Code Black Telemetry — Changelog

All changes logged newest-first.

---

## Credential Hardening Completion - 2026-08-22

Closed the remaining credential/security audit findings without adding new product features.

### Changed
- Fixed Spotter Network sign-in ordering so secure password storage is written and verified before
  account state is committed.
- Fixed Pi/BLE and Live Overlay token save ordering so in-memory token state changes only after
  secure persistence is verified.
- Added secure credential read-state handling for missing, unavailable, corrupt/reauth-required,
  and read-error states.
- Added Settings error feedback for BLE token save/remove failures and credential migration/read
  diagnostics.
- Added Android backup/data-extraction exclusions for the Keystore-encrypted credential preference
  file.
- Added an iOS Keychain-backed `CodeBlackSecureCredentials` Capacitor adapter source file and wired
  it into the iOS app target; native Xcode/device validation remains pending.
- Changed locally blocked duplicate Spotter submissions to `ALREADY_SUBMITTED` instead of generic
  `FAILED`.
- Extended the S24 walkthrough helper to cover force-stop while Chase is active and removed the
  install-specific active-notification UID lookup.

### Validation Notes
- iOS Keychain implementation was source/sync validated on Windows only. Native Xcode compile and
  device runtime validation remain pending on macOS.

---

## Rendered Control Walkthrough Automation - 2026-08-22

Added repeatable rendered-app route/control coverage for desktop browser automation and S24 ADB
smoke workflows.

### Changed
- Added Playwright rendered walkthrough coverage for Weather, Operations, Locate, Alerts, Report,
  Settings, Layers, and the expanded map/radar portal across phone portrait, tablet landscape, and
  desktop viewports.
- Added hard regression assertions that MARK and ESCAPE remain visible only on the Locate/map
  surface.
- Added checks for map layer popovers, provider-backed/deferred layer wording, credential/overlay
  settings state, report-page locked external submission, shared Chase UI state, console/page errors,
  and basic horizontal overflow.
- Added stable selectors only where semantic selectors were ambiguous.
- Added an ADB S24 walkthrough helper for route screenshots, MARK/ESCAPE map-only checks, Chase
  start/end smoke, active-notification cleanup verification, and logcat capture.
- Fixed a rendered Mapbox race where delayed resize callbacks could run after an Atlas map instance
  was removed.
- Added Locate-page map control spacing at tablet/desktop widths so fixed MARK/ESCAPE controls do
  not intercept the map control row.

### Validation Notes
- Browser rendered walkthrough command: `npm run test:walkthrough`.
- Browser rendered walkthrough validates shared UI rendering and control wiring; it does not replace
  physical native Android Chase foreground-service acceptance.

---

## Native Chase Notification Root-Cause QA - 2026-08-22

Re-ran physical S24 Chase notification cleanup acceptance from a clean post-reboot device state and
resolved the blocked credential-hardening acceptance finding as a QA interpretation issue rather
than an active foreground-notification leak.

### Changed
- Updated `docs/APP_EVALUATION.md` to distinguish active notification records from Samsung/Android
  notification archive records for Chase Tracking acceptance.

### Validation Notes
- Native Android Chase Tracking code was not changed.
- Three repeated Start Chase -> MARK -> End Chase cycles on the S24 showed the service and active
  notification present while active, then no active `ChaseTrackingService` and no active
  notification key after End Chase.
- Broad `dumpsys notification --noredact` still lists Chase notification entries under
  `mArchive=Archive`; those are historical records and are not active notifications.

---

## Credential and External Submission Hardening - 2026-08-22

Hardened P0 credential storage and external Spotter Network submission boundaries without adding
new feature families.

### Changed
- Added a shared secure credential abstraction with allowlisted keys for Spotter Network, Pi/BLE
  command, and Live Overlay Telemetry station secrets.
- Added an Android Capacitor plugin backed by Android Keystore AES-GCM encryption for credential
  storage.
- Migrated legacy Spotter Network password, Pi/BLE command token, and Live Overlay station token
  out of Capacitor Preferences when secure write/read verification succeeds.
- Updated Settings so saved secrets are shown only as configured/missing and can be replaced or
  removed without redisplaying raw values.
- Added credential redaction helpers for diagnostics/errors.
- Tightened Spotter Network report submission with explicit user-action boundaries, field
  validation, duplicate submission guards, and unknown-timeout handling.
- Added domain tests covering redaction, migration-result safety, credential key allowlisting,
  Spotter submission validation, duplicate ledger behavior, and MARK/Chaser Net non-submission
  boundaries.
- Documented the storage model, migration behavior, platform status, and external submission
  limits in `docs/credential-and-submission-hardening.md`.

### Validation Notes
- Native Android Chase Tracking code was not changed.
- iOS Keychain runtime validation remains pending on macOS/Xcode; Windows Credential Manager remains
  a future adapter.
- Web preview uses a memory-only development credential fallback and does not persist raw secrets.

---

## Live Overlay Telemetry v0.1 - 2026-08-22

Added an ephemeral current-position telemetry path for CodeBlack-Core livestream overlays without
changing native Chase Tracking or Chaser Net presence behavior.

### Changed
- Added shared live overlay telemetry models, validation, freshness classification, station auth
  checks, and latest-state storage semantics.
- Added a best-effort app publisher that reads from the shared location tracking status, publishes
  only while Chase Mode is active, drops stale packets, and never backfills breadcrumb history.
- Added a Core fetch-handler contract for authenticated ingest and latest-state overlay reads.
- Added Settings controls for `Share Live Overlay Telemetry`, Core endpoint, station ID, station
  token, and visible link status.
- Documented the data model, no-backfill rule, station identity, freshness thresholds, security
  boundary, and deferred Core deployment work in `docs/live-overlay-telemetry.md`.

### Validation Notes
- Live overlay telemetry is independent from Chaser Net and does not enable network presence.
- The repository contains the Core contract/store but not the deployed CodeBlack-Core service.
- Native Android Chase Tracking code was not changed.

---

## Full App Evaluation and Map-Only Operations - 2026-08-22

Audited the current app shell, major reachable pages, map layers, provider states, and operational
controls without starting new feature families.

### Changed
- Restricted global operational controls so MARK and ESCAPE render only on the Locate/map page.
- Added a regression guard that keeps MARK/ESCAPE as map-only controls.
- Added `docs/APP_EVALUATION.md` with current route/control inventory, system readiness,
  platform status, security/privacy concerns, priority matrix, and the next five recommended
  development passes.

### Validation Notes
- Native Android Chase Tracking code was not changed.
- Chaser Net production backend, Level II radar products, production ESCAPE routing, mobile mesonet,
  model/satellite products, CarPlay, Android Auto, and Windows packaging remain deferred.

---

## Road Conditions and Public Cameras v0.1 - 2026-08-20

Wired the existing Road Conditions and Traffic / Public Cameras map-layer foundations to shared
provider-backed data without adding Android-specific business logic or changing native Chase
Tracking.

### Changed
- Added shared road/camera provider contracts, provider registry, viewport filtering, bounded
  caching, request deduplication, cancellation, and stale-cache fallback behavior.
- Added Arkansas DOT IDrive as the first concrete provider for road closures, lane closures,
  construction points, and public traffic cameras.
- Normalized road incidents and public cameras with provider IDs, provider record IDs, freshness,
  provenance, validated coordinates, safe source URLs, and provider attribution.
- Activated Road Conditions and Public Cameras toggles in the Locate layer popover and Layer
  Configuration screen with honest provider/viewport state labels.
- Added Atlas map marker renderers and compact detail popups for road incidents and public cameras;
  camera stills load only when the marker detail is opened.
- Added tests for coordinate/URL/text validation, provider coverage selection, freshness
  classification, malformed data rejection, and normalized road/camera records.
- Documented provider coverage, cache/freshness semantics, provenance, safety boundaries, and
  future provider expansion in `docs/road-camera-providers.md`.

### Validation Notes
- Current concrete provider coverage is Arkansas only. Oklahoma, Kansas, Missouri, and Core-proxy
  providers remain future adapter work.
- Mosaic radar remains the active radar product; native Level II remains deferred.
- Native Android Chase Tracking code was not changed.

---

## Core / Pi Connectivity Hardening - 2026-08-20

Hardened Code Black OPS connection handling for CodeBlack-Core, Raspberry Pi vehicle-node, and
local field-network endpoints without adding a new backend or changing native Chase Tracking.

### Changed
- Added a shared platform-neutral connection status model for configured, connecting, connected,
  degraded, stale, disconnected, and error states.
- Normalized user-configured Pi/Core endpoint handling for LAN IPs, hostnames, HTTPS endpoints, and
  Tailscale-style addresses while rejecting unsafe schemes and credential-bearing URLs.
- Improved Pi endpoint test feedback with bounded timeouts and clearer failure categories such as
  timeout, auth failure, HTTP error, malformed response, and network failure.
- Centralized retry/backoff, freshness classification, endpoint transport inference, and cancellable
  HTTP helpers for telemetry and streaming clients.
- Separated connection reachability from telemetry freshness so the UI can show connected-but-stale
  and disconnected-with-last-known-data states honestly.
- Added Operations and Settings diagnostics for endpoint, transport, last success, data age, retry
  timing, and sanitized error summaries.
- Guarded streaming status refreshes and telemetry polling against stale in-flight responses
  overwriting newer state.

### Validation Notes
- Native Android Chase Tracking service code was not changed.
- Core/Pi health remains client-side and adapter-based; the real Pi backend is still a separate
  field-node codebase and no production Core backend was added in this pass.
- HTTP remains supported for explicitly configured local/Tailscale field endpoints; unsafe URL
  schemes are rejected by the app before save/test.

---

## iPhone / iPad Foundation Validation - 2026-08-20

Hardened the shared platform boundary for iPhone/iPad readiness without expanding Chaser Net.

### Changed
- Kept the existing Capacitor iOS SPM project as the active iOS host and added an explicit
  `cap:sync:ios` / `ios:sync` build path.
- Replaced shared persistent-tracking capability checks that implied Android foreground-service
  mechanics with platform-neutral native persistent-location/background-execution capability names.
- Updated persistent Chase Tracking Settings copy so iOS/Web states say background tracking is not
  configured instead of exposing Android implementation wording.
- Added iOS local-network usage wording for user-configured Code Black Core/Pi endpoints.
- Added `docs/platform-status.md` with Android, iPhone/iPad, and Windows capability status and
  deferred native adapter notes.
- Fixed a focused Android stop-path race discovered during S24 regression: the native plugin now
  lets `ChaseTrackingService` process its STOP intent and own foreground-notification cleanup
  instead of immediately stopping the service out from under it.
- Restored the expanded mosaic radar portal's phone-portrait height chain so the nested Atlas map
  stays visible instead of collapsing below the header.

### Validation Notes
- Native Android tracking sampling, permissions, storage, and background-tracking behavior were not
  changed; only the plugin stop path was narrowed to preserve service-owned cleanup.
- iOS native Xcode compile/runtime validation still requires macOS/Xcode; Windows validation is
  limited to shared build, Capacitor iOS sync/static project inspection, and Android regression.
- Mosaic remains the active radar experience; native Level II remains deferred.

---

## OPS App Stabilization Pass - 2026-08-19

Started the recovery-safe field-app stabilization branch.

### Changed
- Limited global MARK/ESCAPE controls to operational field pages so Settings, Operations, and
  Layers stay uncluttered while MARK remains one-tap on Weather/Locate/Report.
- Added a MARK double-tap guard to prevent accidental duplicate immediate markers.
- Improved Android Back behavior so map layer popovers close before leaving the current page.
- Made expanded map camera state clearer with explicit follow/free/panning status wording.
- Locked Chaser Net presence sharing OFF while the production backend/auth provider is not
  configured, while preserving visible privacy/readiness controls.
- Made future/provider-backed map layers display as unavailable instead of toggleable live layers
  until Road Conditions, Traffic Cameras, Probes, and Chaser Net providers are actually configured.
- Normalized Pi endpoint save/test behavior and cleared stale endpoint test state after edits.
- Clarified Core/Pi diagnostic state on the Operations page.
- Hardened native Android chase-stop cleanup so the service removes foreground state during both
  explicit STOP handling and service destruction.

### Validation Notes
- Native Android Chase Tracking logic was not redesigned, but the stop/notification cleanup path
  changed after S24 smoke found an orphaned pre-patch notification record.
- S24 smoke verified start, active tracking status, MARK feedback, map rendering, and local UI end
  state. The pre-patch Samsung notification record could not be cleared by app force-stop or shell
  snooze, so final notification cleanup needs a fresh device notification state or reboot to
  reaccept conclusively.
- Mosaic remains the only active radar UI; Level II remains deferred.

---

## Code Black Chaser Net v0.2 Application Review Foundation - 2026-08-19

Extended the Chaser Net foundation toward screened membership without enabling a public production
network.

### Changed
- Added application draft, submission, moderator review, approval, and rejection contracts to the
  shared Chaser Net backend harness.
- Added moderator-only application review queue access, code-of-conduct and experience gates, and
  application-specific audit events.
- Added snapshot import/export and persistence-adapter contracts so Chaser Net backend state can
  move to a durable API/database layer without changing shared domain semantics.
- Updated the Chaser Net Layers panel to show v0.2 application/review contracts while keeping
  runtime production state honest as backend-not-configured.
- Expanded domain tests for application submission, moderator-only review, approved probationary
  member creation, audit logging, and snapshot reload.

### Validation Notes
- Public application UI, production auth, production storage, deployment, and admin dashboards remain
  deferred.
- Presence sharing remains OFF by default and remains separate from local Chase Tracking.

---

## Code Black Chaser Net v0.1 Foundation - 2026-08-18

Created the first production-minded Chaser Net backend/domain/network foundation without enabling a
fake production network.

### Changed
- Expanded the shared Chaser Net service boundary with authenticated identity, member profiles,
  screened membership states, network roles, teams, privacy, presence, reports, moderation, audit,
  realtime event, and API contract models.
- Added server-side-style access-control helpers and an in-memory backend test harness covering
  authenticated writes, team-only location privacy, report visibility, report retraction, moderation
  permission boundaries, coordinate validation, heartbeat freshness, and rate limiting.
- Added local Chaser Net privacy controls under the Layers page. Presence sharing remains OFF by
  default and is explicitly separate from local Chase Tracking/breadcrumb collection.
- Wired disabled-by-default Chaser Net member and Chaser Net report map layers through the existing
  viewport-aware and zoom-clustering map path. No fake members or reports render in production.
- Documented Chaser Net trust/privacy semantics, non-official human-report provenance, retention
  assumptions, realtime/read/write contracts, and deferred features in `docs/chaser-net-v0.1.md`.

### Validation Notes
- Chaser Net remains backend-not-configured at runtime until a real auth/backend provider is wired.
- Mosaic remains the active radar experience. Native Level II REF/VEL/SRV/CC remains deferred.

---

## S24 UI Polish and Checkpoint Hygiene - 2026-08-18

Targeted cleanup pass after the accepted native Chase Tracking build.

### Changed
- Added narrow ignore rules for local QA artifacts and local Codex/Claude launch config so device
  screenshots/logs are not accidentally committed.
- Tightened Chase Session settings spacing and status badge behavior for phone portrait without
  changing the tablet/landscape Settings architecture.
- Reworded persistent tracking status copy to use platform-neutral operational language instead of
  exposing Android implementation details in normal UI.
- Corrected shared tracking status normalization so a running native platform tracker is not
  mislabeled as unsupported, and hardened Chase start/end feedback against failed platform calls.
- Added shared map marker family classes for team/chaser/report/probe/road/camera/MARK objects and
  a consistent stale-marker treatment for future live layers.

### Validation Notes
- Android native Chase Tracking service code was not changed in this pass; the previous accepted
  foreground, background, locked-screen, MARK, END CHASE, and notification cleanup behavior is
  preserved.
- Mosaic remains the active radar experience. Native Level II REF/VEL/SRV/CC remains deferred.

---

## S24 Hands-Free Chase Acceptance Stabilization - 2026-08-18

Finalized the latest Samsung S24 acceptance pass around Chase Mode cleanup, native tracking state,
and mosaic-only radar validation.

### Changed
- Fixed the active mission status strip so it no longer steals scroll height from phone portrait
  Settings and other non-weather pages while a chase is active.
- Tightened Android native Chase Tracking stop behavior so `END CHASE` marks native tracking
  inactive immediately, reports stop-pending correctly during Android service teardown, and cancels
  the chase notification through both supported notification-ID forms.
- Reset the native pending breadcrumb buffer when a new native chase session starts, preventing
  old session points from mixing into a fresh session's pending native queue.

### Validation Notes
- Rebuilt and installed the exact debug APK on the connected Samsung S24 (`SM-S921U`).
- Physical S24 evidence confirms native foreground/background/locked tracking worked during the
  pass, `MARK` persisted with the active session, `END CHASE` stopped point growth, and a second
  session used a distinct session ID.
- Final launch state after the cleanup fix is inactive, with no active `ChaseTrackingService` and
  no active Code Black chase-tracking notification.
- Mosaic radar remains the active radar experience; native Level II REF/VEL/SRV/CC stays deferred.

---

## Cross-Platform Chase Tracking Abstraction - 2026-08-18

Kept Code Black OPS pointed at one shared product core while refining the Android native tracking
work as a platform adapter.

### Changed
- Added platform-neutral service contracts and models for location tracking, normalized location
  observations, platform capabilities, operational notifications, and display control.
- Routed Chase Mode start/stop/status, pending breadcrumb sync, and UI status through the shared
  `LocationTrackingService` instead of calling Android-native tracking directly from App/Settings.
- Added normalized breadcrumb quality handling for good/degraded/stale/invalid observations while
  preserving raw accuracy, speed, heading, altitude, provider, and source values when available.
- Added balanced, high-detail, and battery-saver tracking presets as shared intent, with Android
  translating those presets into native sampling intervals and distance thresholds.
- Added mission-session recovery from an existing active native tracking session so reopening OPS
  can reconcile with the same session ID instead of creating a duplicate chase.
- Moved keep-awake and brightness behavior behind a `DisplayControlService` abstraction to reduce
  UI coupling to browser or platform-specific display APIs.
- Added domain tests for location quality classification, stale/invalid handling, duplicate
  breadcrumb filtering, improved-accuracy retention, and tracking preset policy values.

### Validation Notes
- `npm test`, `npm run lint`, `npm run build`, and `npm run android:debug` pass after the
  abstraction update.
- The exact debug APK was installed on the connected Samsung S24, but final interactive physical QA
  for MARK/END/radar still requires the phone to be unlocked.

---

## Native Chase Tracking Foreground Service - 2026-08-18

Implemented the first Android-native Chase Mode tracking pass for physical S24 validation.

### Changed
- Added a Capacitor-backed Android foreground location service that starts only with an explicit
  Chase Mode session and posts a persistent "Code Black OPS - Chase Tracking Active" notification.
- Added Android foreground-service location and notification permission wiring without requesting
  background location for this pass.
- Added bounded native breadcrumb persistence tied to the active chase session, including timestamp,
  coordinates, accuracy, altitude, speed, heading, provider/source, and quality flags.
- Synced native service breadcrumbs back into the existing app breadcrumb store on resume/poll so
  valid points are not lost while the WebView is suspended.
- Updated MARK to prefer the freshest native chase location when foreground tracking is active.
- Added native tracking status visibility in the Chase Session settings panel and a compact active
  chase status strip outside Settings.
- Tightened resume recovery so an explicitly stopped native tracking service is not restarted as if
  it had crashed.
- Hardened native status reporting so stale stored tracking state is reported as degraded if the
  foreground service is not actually running after an update or force-stop.
- Fixed the S24 portrait Settings layout so Chase Session controls remain visible and touchable.

### Validation Notes
- Physical S24 QA confirmed the native foreground service and notification are active and native
  breadcrumbs continue while OPS is backgrounded and while the screen is locked.
- The current app radar UI exposes wide-area mosaic radar; legacy REF/VEL/SRV/CC product switching
  is not currently exposed in the source tree and was not claimed as physically passed.

---

## Roadmap Pass 1 Foundations - 2026-08-18

Implemented the first production-quality integration pass for the Code Black OPS roadmap while
preserving the existing tablet cockpit, radar, telemetry, Pi/BLE, streaming, navigation, and map
camera foundations.

### Changed
- S24 physical QA found the Android activity was still locked to landscape. Removed the main
  activity orientation lock so phone portrait can use the new scroll dashboard while landscape and
  tablet cockpit layouts remain available.
- Fixed the phone portrait Weather-page compact radar card on the S24 by forcing Mapbox resize
  when the active map/card changes and by giving the compact map a stable portrait height.
- Moved the MARK control higher on the Locate page in phone portrait so it does not cover the map's
  bottom Layers control.
- Fixed S24 portrait Settings rows so labels, segmented controls, sliders, and action buttons wrap
  cleanly instead of compressing vertically; hidden floating operational buttons on Settings where
  they were covering controls.
- Fixed Light theme contrast on the S24 by overriding the hard-coded tactical header, panel, dock,
  and segmented-control surfaces after the phone responsive rules.
- Added a phone-portrait dashboard path that uses fixed vertical cards instead of shrinking the
  tablet layout, keeping warning status, radar, location, weather, wind, telemetry, streaming, and
  system health reachable in a scroll flow.
- Added Display settings for theme, clock mode, keep-awake behavior, OPS brightness, and optional
  Chase Mode auto-awake behavior. Brightness control is in-app scoped and releases on lifecycle
  changes instead of permanently overwriting system brightness.
- Replaced the old full-red Night Vision behavior with a restrained Night theme using dark
  surfaces and red accents. Dark, Light, Night, and System theme modes are now supported.
- Reworked the header clock around live `Intl.DateTimeFormat` formatting for Local, Central, and
  Zulu modes so timezone and DST changes are not cached at startup.
- Added a lightweight Mission Session lifecycle, persistent bounded breadcrumb capture tied to the
  active session, and a fast MARK action for recording the current GPS position.
- Added reusable viewport, detail-level, and clustering helpers for map layers without changing
  radar rendering.
- Added disabled/not-configured foundations for Road Conditions, Traffic/Public Cameras, Code
  Black Probes, and Code Black Chaser Net map layers.
- Added a reusable operational map-layer manager model for visibility, opacity, order, viewport
  context, loading/stale/unavailable/error state, and provenance.
- Expanded Road Conditions and Traffic/Public Camera layer contracts with geometry, closure state,
  event timing, direction, stale state, public preview/stream URL slots, and source metadata while
  keeping providers honestly not-configured.
- Added a press-and-hold ESCAPE foundation that builds an egress context from current GPS/session
  state and reports degraded/unavailable input states without claiming to calculate a safe route.
- Added Chaser Net, mobile mesonet, station metadata, and observation provenance domain models so
  future official, human, experimental, and Code Black sensor data can remain distinct.
- Added focused non-UI tests for clock formatting, viewport filtering, clustering, and Chaser Net
  privacy behavior, map-layer state, and egress degraded-data handling.

### Deferred
- No production Chaser Net backend, public signup, moderation, Spotter Network submission, GOES/GLM,
  HRRR/RAP ingestion, turn-by-turn navigation, Android Auto, CarPlay, or emergency escape routing
  was implemented in this pass.
- Road, camera, probe, and Chaser Net layers intentionally show provider-not-configured states
  unless a real provider is wired later.

---

## Laptop PWA GPS Hardening - 2026-08-18

Tightened the Windows laptop/PWA path after the initial launcher pass.

### Changed
- Hardened browser GPS handling so transient laptop geolocation timeouts remain in a searching
  state instead of becoming a hard dashboard error.
- Added browser permission preflight, secure-localhost checks, and a fresh GPS request when the
  app window returns to focus.
- Replaced generic browser copy with laptop-aware labels such as Laptop GPS and Standalone Laptop.
- Added visible unsupported/error messaging for laptop GPS permission or system-location failures.
- Hardened the Windows launcher to reuse an existing Code Black preview server only when verified,
  otherwise choose the next free localhost port and log preview startup to the temp directory.
- Bumped the PWA runtime cache and added manifest metadata for the laptop install path.

---

## Laptop PWA Launcher - 2026-08-13

Added a Windows laptop path for running Code Black OPS as a local PWA-style app window.

### Changed
- Added `npm run desktop`, which starts the production Vite preview server on localhost and opens
  the app in Edge/Chrome app-window mode.
- Added `scripts/launch-webapp.ps1` for the desktop shortcut target.
- Updated the service worker tile cache host list from the retired RainViewer host to the current
  Iowa Environmental Mesonet mosaic host.

### Notes
- This is a laptop web/PWA path, not a native Windows BLE implementation.
- Pi HTTP/Tailscale, Mapbox maps, mosaic radar, alerts, reports, settings, and browser GPS remain
  the expected laptop capabilities.

---

## AltStore Source "Not Valid JSON" Fix, Attempt 3 - 2026-08-12

`altstore-source.json` never successfully loaded in AltStore's "Add Source" flow -- confirmed by
checking this repo's history (the field causing trouble has been present since the file's very
first commit) and by the fact this session's earlier "debugged through many rounds" work was all
about the Codemagic build pipeline, never this in-app step. Took three passes to actually fix,
each one narrowing the cause with real evidence instead of guessing blind:

1. **Attempt 1** (previous entry, since folded into this one): changed `appPermissions.privacy`
   from `{}` to `[]`, suspecting a type mismatch. Did not fix it.
2. **Attempt 2**: removed `appPermissions` entirely, since it was the one field never confirmed
   against a real install. Still did not fix it. Along the way, confirmed via a user-provided
   on-device Safari screenshot that the phone really was receiving the exact fixed file byte for
   byte -- ruling out network interference, CDN staleness, or a wrong URL -- and confirmed via the
   user successfully adding one of AltStore's own "Recommended Sources" that AltStore's JSON
   parsing works fine in general, isolating the bug to our file's schema specifically.
3. **Attempt 3 (this one)**: pulled a real, currently-working AltStore source
   (`flyinghead/flycast-builds` on GitHub, referenced from AltStore's own recommended-sources list)
   and diffed it against ours. The two structural differences: our file had a top-level `sourceURL`
   field and a per-app `versions` array (a duplicate historical-version list) that their
   known-good file doesn't have at all. Removed both, leaving only the flat fields their file uses
   (`name`, `bundleIdentifier`, `developerName`, `subtitle`, `localizedDescription`, `iconURL`,
   `version`, `versionDate`, `versionDescription`, `downloadURL`, `size`). Updated
   `codemagic.yaml`'s publish step to match (no longer writes `versions[]`).

### Not Done / Needs Follow-up
- Still pending on-device confirmation that this specific fix resolves it -- everything here is
  evidence-based elimination against a real reference file, not a decode error message actually
  seen from AltStore's source code (still no network access to that from this session). If this
  also fails, the next step is copying the known-good file's exact keys and values in and swapping
  them back to ours one at a time.
## Samsung Short-Landscape Polish - 2026-08-12

Fixed layout issues found while testing the Android debug APK directly on a connected Samsung
SM-S921U in landscape.

### Changed
- Added a dedicated short-landscape header layout so the Code Black subtitle no longer clips and
  the clock/status cluster stays readable.
- Restored bottom-dock labels in phone landscape while keeping the dock compact and flush to the
  bottom of the screen.
- Reworked Weather dashboard short-landscape sizing so Location & Motion no longer clips the GPS
  tile.
- Reworked Operations short-landscape behavior into a scrollable vertical stack instead of
  compressing the tablet grid into overlapping cards.

### Validation
- Built and installed the debug APK on Samsung SM-S921U via ADB.
- Captured physical-device screenshots for Weather, Operations, Locate, Report, Settings, and
  Layers under `artifacts/android-qa/`.

---

## Field QA Fix Pass - 2026-08-12

Fixed issues found during the full-app control/function inspection on the Samsung test device.

### Changed
- Backed off BLE retries after Android Nearby Devices permission denial so the system prompt does
  not keep reappearing every few seconds.
- Updated nearby places, POI pins, and Spotter Network position refreshes to read the latest GPS
  coordinates on scheduled polls instead of holding the coordinates from app/page launch.
- Routed nearby map buttons and Spotter registration through Capacitor Browser with a web fallback.
- Removed the unfinished Winter report toggle and disabled report submission until GPS and at
  least one hazard are present.
- Allowed streaming controls to use the existing Pi HTTP fallback path when BLE status is stale.
- Added duplicate-name and image-read guardrails for custom POI pins.
- Cleaned stale radar wording, CSS, and tooltips after the mosaic-only radar cleanup.

### Validation
- `npm run lint` passes with only existing Fast Refresh warnings.
- `npm run build` passes with the existing Mapbox chunk-size warning.
- `npm run android:debug` passes and syncs the Capacitor Browser plugin.
- Samsung install/log smoke was not rerun because no ADB device was connected after the build.

---

## Live Vehicle Dot Pulse Smoothing - 2026-08-12

Fixed the live-location dot pulse path after device testing showed the pulse still looked buggy.

### Changed
- Moved the animated vehicle pulse from per-frame Mapbox paint-property updates to a CSS-composited
  DOM pulse around the vehicle marker.
- Paused the pulse animation on inactive/offscreen map instances so the Weather and Locate maps do
  not both animate the live dot at the same time.
- Kept the accuracy ring, heading line, custom marker color, marker shape, and marker size settings
  intact.

### Validation
- `npm run lint` passes with existing warnings.
- `npm run build` passes with the existing Mapbox chunk-size warning.

---

## Mosaic-Only Radar Cleanup - 2026-08-12

Removed the retired single-site radar implementation so the app stays mosaic-only for now.

### Changed
- Removed the Operations Radar Engine panel and stale Settings copy for on-device Level II decode.
- Removed the web radar service wrappers, radar loop helper, Mapbox decoded-image radar layer, and
  desktop radar worker files.
- Removed Android native radar plugin registration, Java radar plugin/service/site classes, and the
  packaged `libcodeblack_radar.so` native library.
- Removed the NEXRAD decoder npm packages and the `radar:worker` script.
- Kept range rings working by centering them on current GPS instead of the removed radar-site frame.
- Updated radar architecture docs to mark the single-site decoder path retired.

### Preserved
- Weather and Locate maps continue to use the Iowa Environmental Mesonet NEXRAD N0Q mosaic.
- Map camera/follow behavior, pan/zoom, range rings, alerts/watches, Spotter Network chasers, POI
  pins, breadcrumbs, report feed, BLE/Pi telemetry, streaming controls, and vehicle-display work
  were preserved.

---

## iPhone Device-Language and Map POI Pin Polish - 2026-08-12

Cleaned up issues found in the installed iPhone build screenshots.

### Changed
- Replaced visible "tablet" GPS/mode copy with dynamic device labels such as iPhone GPS, iPad GPS,
  Galaxy GPS, or Internal GPS based on Capacitor device info.
- Updated Operations and Settings diagnostics so standalone mode and GPS source labels reflect the
  current device instead of assuming a tablet.
- Made nearby map pins use clear category icons by default for gas, food, lodging, and ER/hospital
  instead of falling back to plain dots.
- Increased POI marker size and switched POI glyphs to white silhouettes for better readability on
  dark Mapbox maps.
- Added a phone-landscape Weather layout guard so the dashboard stacks vertically instead of
  crushing tablet-style columns into a short iPhone viewport.

### Preserved
- Internal telemetry source names, Pi/BLE fallback behavior, map camera/follow behavior, Spotter
  Network layers, reports, alerts, and radar functionality were not changed.

---

## Release Hygiene and Device Diagnostics - 2026-08-12

Added release checks and in-app diagnostics before the next physical-device test pass.

### Changed
- Pinned Capacitor core, Android, iOS, and CLI packages to the same exact version to prevent
  wrapper drift across installs.
- Added `npm run release:sanity` to validate the AltStore source, Capacitor package alignment,
  release warnings, lint, web build, Capacitor sync, and Android debug build in one command.
- Added Settings diagnostics with platform, app/native version, branch/commit, build time, GPS
  state, service state, Pi endpoint, BLE state, and Spotter Network sign-in state.
- Refined tablet Settings layout after rendered QA so diagnostics and controls use wider columns
  instead of cramped three-column cards.
- Added a device test checklist for Android tablet, Android phone, iPad, iPhone, and tester
  screenshot handoff.
- Clarified Android Auto as an experimental local-testing surface until host validation and real
  head-unit testing are completed.

### Preserved
- Dashboard behavior, radar/maps, report feed behavior, alert logic, BLE/Pi telemetry, and Spotter
  Network report submission were not changed.

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
