# Code Black OPS Audit Handoff - 2026-08-06

## Current State

Code Black OPS is a working Android tablet app built with React 19, TypeScript, Vite, and Capacitor
8. The app uses a seven-page landscape pager for Weather, Operations, Locate, Alerts, Report,
Settings, and Layers. The tablet remains the primary chase operations interface.

The real Raspberry Pi backend is not included in this checkout. Existing project notes identify it
as a separate Pi-side codebase at `~/CodeBlack` with Flask dashboard/API, BLE bridge, ESP bridge,
lighting control, and systemd services.

## What Is Working

- BLE-first tablet telemetry through `BleTelemetryClient`.
- HTTP Pi endpoint fallback through Settings / Pi Endpoint.
- Tablet GPS fallback when vehicle GPS is stale or invalid.
- Last-known telemetry persistence and offline state display.
- Wide-area NEXRAD mosaic radar through Mapbox raster tiles.
- Mapbox Atlas map with mosaic radar, warnings, watches, team, chaser, POI, and breadcrumb layers.
- Spotter Network sign-in, nearby chaser view, report submission, and self-filtering.
- Nearby gas, food, lodging, and hospital lookups through Overpass.
- App crash boundary with guarded auto-reload.
- Android immersive landscape shell and Android back handling.

## What Was Inspected

- Root project structure, package scripts, TypeScript config, Capacitor config.
- `src/App.tsx`, navigation/pager behavior, app resume/pause handling.
- Telemetry provider, BLE client, HTTP fallback, simulator fallback, quality mapping.
- Settings persistence, BLE command token storage, team/pin/layer preferences.
- Situational services: alerts, SPC outlooks, watches, nearby places, spotters, reports.
- Map components and Mapbox layer managers.
- Native Android manifest, network security config, and Java plugins.
- Scripts and install workflow.
- Documentation and changelog.
- Security-sensitive strings and committed environment files.

## Safe Fixes Made

- Replaced stale Vite-template `README.md` with a current project overview and guardrails.
- Replaced stale Phase 1 `ARCHITECTURE.md` with the current pager, BLE, native-radar, and boundary model.
- Added `.env.example` with sanitized configuration keys and no secrets.
- Added this audit handoff/TODO document.
- Updated `PROJECT_STATE.md` with a pointer to this audit.
- Updated `CHANGELOG.md` with this audit pass.

No runtime code, UI behavior, streaming implementation, networking topology, schema, or Pi service
behavior was changed.

## Audit Findings

### CRITICAL

No confirmed critical defects were fixed or newly introduced in this pass.

### HIGH

1. Plaintext credentials can be included in Android backups
   - Status update 2026-08-22: superseded by `docs/credential-and-submission-hardening.md`.
     Spotter password, Pi/BLE command token, and Live Overlay station token now use the shared
     credential boundary on Android with legacy Preferences migration.
   - Affected files: `android/app/src/main/AndroidManifest.xml`, `src/services/spotterAccount.ts`, `src/services/settings.ts`
   - Current behavior: `allowBackup="true"` while Spotter Network password and BLE command token are stored in Capacitor Preferences.
   - Expected behavior: pre-release policy may allow local plaintext, but backup/export policy should be explicit before field/public use.
   - Why it matters: backup extraction or device migration can expose a personal Spotter password and vehicle command token.
   - Recommended fix: disable backup or add backup exclusion rules; consider Android encrypted storage or re-prompting for personal passwords.
   - Safe to fix now: no, it changes device backup behavior.
   - User approval required: yes.

2. Pi networking/recovery topology cannot be verified from this repo
   - Affected files: repository-wide; Pi code is absent.
   - Current behavior: only tablet client and notes exist here; NetworkManager, recovery AP, hotspot priorities, watchdogs, and systemd units are not included.
   - Expected behavior: field readiness audit needs the real Pi service/profile definitions.
   - Why it matters: Wi-Fi failover/recovery AP reliability is a chase-critical operational concern.
   - Recommended fix: audit the Pi-side `~/CodeBlack` repo and live `/etc/NetworkManager/system-connections`, `systemctl`, and watchdog configuration.
   - Safe to fix now: no.
   - User approval required: yes, because it touches Pi networking.

3. Nearby/POI/spotter hooks can use stale coordinates while driving
   - Affected files: `src/hooks/useNearbyPlaces.ts`, `src/hooks/useNearbyPoiList.ts`, `src/hooks/useSpotters.ts`
   - Current behavior: effects depend on `gps == null` to avoid polling on every telemetry tick; nearby hooks close over the GPS value from effect start, and spotter polling also uses that captured value.
   - Expected behavior: avoid jitter-driven fetch storms while still refreshing after meaningful movement.
   - Why it matters: nearby amenities, POI pins, and spotter distances can remain centered on an old location during a chase.
   - Recommended fix: use a live `gpsRef` plus a movement threshold/geohash/grid trigger; alerts/SPC already use a ref pattern.
   - Safe to fix now: likely small, but behavior-affecting and should be validated on device.
   - User approval required: yes for this audit pass.

### MEDIUM

1. Native diagnostic recon activity is exported and hardcoded
   - Affected files: `android/app/src/main/AndroidManifest.xml`, `NativeMapboxReconActivity.java`
   - Current behavior: exported activity with static test point, hardcoded route/radar asset.
   - Expected behavior: diagnostic surfaces should be non-exported or gated if not required externally.
   - Why it matters: increases external launch surface and can confuse future maintainers.
   - Recommended fix: confirm whether it is still used, then set `exported=false` or remove the intent filter.
   - Safe to fix now: no, because external diagnostic launch may be intentional.
   - User approval required: yes.

2. Global Android cleartext traffic is enabled
   - Affected files: `android/app/src/main/res/xml/network_security_config.xml`, `AndroidManifest.xml`
   - Current behavior: cleartext HTTP is globally permitted for user-configured Pi LAN/Tailscale endpoints.
   - Expected behavior: cleartext policy should be documented and bounded where practical.
   - Why it matters: broad HTTP allowance increases risk if any non-local endpoint is configured.
   - Recommended fix: keep only if local/Tailscale HTTP remains a requirement; otherwise move Pi APIs to HTTPS or narrow domains.
   - Safe to fix now: no.
   - User approval required: yes.

3. No automated unit/integration test suite
   - Affected files: `package.json`, repository-wide.
   - Current behavior: validation is lint/build/Android build/device screenshots.
   - Expected behavior: core service transforms and hooks should have targeted tests.
   - Why it matters: telemetry/nearby logic is safety-relevant and easy to regress.
   - Recommended fix: add small tests for telemetry normalization, BLE fragment reassembly, and nearby movement refresh.
   - Safe to fix now: no new test framework was authorized in this audit.
   - User approval required: yes.

4. Project state has stale fragments
   - Affected files: `PROJECT_STATE.md`
   - Current behavior: still says five-page pager and has some historical package notes.
   - Expected behavior: handoff docs should separate current truth from history.
   - Why it matters: future developers can make wrong assumptions.
   - Recommended fix: continue consolidating project docs around this audit handoff and current architecture doc.
   - Safe to fix now: partially done with pointer and root docs.
   - User approval required: no for docs-only cleanup.

### LOW

1. Root scripts are not grouped consistently
   - Affected files: `install-codeblack-ops.ps1`, `start-radar-worker.ps1`, `start-radar-worker.sh`, `scripts/`
   - Current behavior: most helper scripts are at root, while screenshot helper is under `scripts/`.
   - Recommended fix: leave for now; moving scripts would require workflow updates.
   - Safe to fix now: no need.
   - User approval required: no if done later as docs/script cleanup.

2. Some comments contain historical implementation archaeology
   - Affected files: many `src/` files.
   - Current behavior: comments preserve bug history and owner decisions.
   - Recommended fix: keep field-relevant comments; trim only if they become misleading.
   - Safe to fix now: no broad cleanup needed.
   - User approval required: no.

## Streaming Readiness Review

2026-08-07 update: the Pi streaming backend foundation is now implemented and validated, and the
tablet Operations page is now authorized to control it. The tablet-side Mission Streaming card was
added in `MissionStreamingPanel`. The larger streaming/producer/Core stack remains deferred.

Recommended tablet state model:

- `OFF`
- `STARTING`
- `LIVE`
- `DEGRADED`
- `RECONNECTING`
- `FAILED`

Use two independent stream targets:

- KNWA Stream
- Code Black Stream

Implemented tablet integration points:

- UI location: Operations page, near existing Pi/Radar diagnostics, as a compact Mission Streaming card.
- Tablet service boundary: `src/services/streaming.ts`, not direct Pi parsing in the UI.
- Pi boundary: Pi owns ingest, FFmpeg/MediaMTX/recording/reconnect/network failover.
- Core boundary: Code Black Core owns overlays, OBS/producer workflows, archival, and distribution.

Pi endpoints used by the tablet:

- `GET /api/local/stream/status`
- `GET /api/local/stream/camera`
- `GET /api/local/stream/knwa`
- `GET /api/local/stream/code-black`
- `GET /api/local/stream/recording`
- `POST /api/local/stream/knwa/start`
- `POST /api/local/stream/knwa/stop`
- `POST /api/local/stream/code-black/start`
- `POST /api/local/stream/code-black/stop`
- `POST /api/local/stream/recording/start`
- `POST /api/local/stream/recording/stop`

BLE commands used by the tablet:

- `stream.knwa.start`
- `stream.knwa.stop`
- `stream.code_black.start`
- `stream.code_black.stop`
- `recording.start`
- `recording.stop`

Status payload normalization retains target state, desired-on state, last error, bitrate, fps,
resolution, reconnect count, storage warning, and updated timestamp where present.

Prerequisites:

- Real DJI ingest test.
- KNWA credentials/config on the Pi.
- Code Black Core video ingest availability.
- Detailed producer/Core connectivity semantics.
- PREP/LIVE mission mode and preflight checklist.
- Prioritize-KNWA/panic action.
- Storage remaining time and retention controls.

Risks:

- Stream keys or RTMP/SRT URLs leaking into tablet/browser logs.
- Pi CPU/thermal/network load impacting BLE/ESP telemetry.
- UI claiming LIVE when only local ingest is alive; tablet now waits for Pi status before showing LIVE.
- Recording and streaming lifecycle split-brain if tablet disconnects.

## Networking Review

Actual implementation in this repo:

- BLE is the primary tablet-to-Pi telemetry and command path.
- HTTP Pi endpoint is optional fallback, user-configurable, and can be LAN, `.local`, or Tailscale.
- No NetworkManager profiles, hotspot profiles, recovery AP files, PiWX-Recovery definitions, or Pi watchdog units are present.
- No MediaMTX/FFmpeg/service definitions are present.

Proposed future model comparison:

- BLE for tablet telemetry: already aligned.
- Pi onboard Wi-Fi available for infrastructure/WAN: cannot verify from this checkout.
- USB Wi-Fi as second WAN: not present here.
- Starlink, known infrastructure Wi-Fi, phone hotspot priority/failover: not present here.
- Recovery AP/PiWX-Recovery: referenced by the user but not present in this checkout.

Needed before changing networking:

- Inspect live Pi NetworkManager profiles and active devices.
- Confirm onboard vs USB Wi-Fi roles.
- Confirm recovery AP trigger and whether it conflicts with infrastructure WAN use.
- Define priority order and failure detection.
- Add watchdog/readiness docs and tests on the Pi side.

## Things Requiring User Approval

- Any streaming implementation beyond tablet control/status of the existing Pi API.
- Any Pi networking redesign or NetworkManager profile change.
- Backup/credential storage policy changes.
- Disabling/export changing native diagnostic activity.
- Adding test framework or larger service tests.
- Moving/deleting prototype radar worker.
- Any UI repositioning, visual redesign, radar layout changes, or navigation changes.

## Master TODO

### P0 - Must Fix Before Field Use

- Task: Verify Pi networking/recovery AP/watchdog configuration on the actual Pi.
  Reason: this repo cannot prove recovery behavior.
  Subsystem: Pi networking.
  Complexity: medium.
  Dependencies: Pi access.
  Independent: yes.

- Task: Decide backup/credential policy for Spotter password and BLE command token.
  Reason: current Preferences storage can be included in Android backups.
  Subsystem: Android/security.
  Complexity: small.
  Dependencies: owner policy decision.
  Independent: yes.

### P1 - High Priority

- Task: Fix stale GPS handling in nearby/POI/spotter hooks with a movement threshold.
  Reason: field data can stay centered on old coordinates.
  Subsystem: nearby/spotters/maps.
  Complexity: small.
  Dependencies: device validation.
  Independent: yes.

- Task: Audit Pi BLE command auth/trusted-device policy.
  Reason: shared token is current protection for vehicle hardware commands.
  Subsystem: BLE/Pi/security.
  Complexity: medium.
  Dependencies: Pi BLE protocol docs.
  Independent: yes.

- Task: Exercise stream status/control contract against the real Pi during a live ingest test.
  Reason: tablet should remain control/status only and Pi must remain source of truth.
  Subsystem: streaming/Pi/tablet.
  Complexity: small.
  Dependencies: Pi streaming backend, camera source, destinations.
  Independent: no.

### P2 - Useful Improvement

- Task: Add targeted tests for telemetry normalization and radar loop frame ordering.
  Reason: catches regressions in core data logic.
  Subsystem: validation.
  Complexity: medium.
  Dependencies: test framework choice.
  Independent: yes.

- Task: Clarify or remove diagnostic NativeMapboxReconActivity after confirming usage.
  Reason: hardcoded/exported prototype surface is confusing.
  Subsystem: Android/native.
  Complexity: small.
  Dependencies: owner approval.
  Independent: yes.

- Task: Add detailed stream metrics only after the compact panel is field-proven.
  Reason: operator may need bitrate/fps/reconnect/storage truth without cluttering the main card.
  Subsystem: streaming UI.
  Complexity: medium.
  Dependencies: real Pi payloads and user approval for expanded details.
  Independent: no.

### P3 - Polish / Future

- Task: Continue consolidating long historical comments into docs when they become stale.
  Reason: reduces maintenance load without losing decisions.
  Subsystem: docs/code comments.
  Complexity: small.
  Dependencies: none.
  Independent: yes.

- Task: Organize root helper scripts or document why they are root-level.
  Reason: easier onboarding.
  Subsystem: tooling.
  Complexity: tiny.
  Dependencies: none.
  Independent: yes.

### User Approval Required - Streaming Tasks

- Task: Implement Pi stream supervisor.
  Reason: Pi must own DJI ingest, FFmpeg/MediaMTX, reconnect, recording, and stream health.
  Subsystem: Pi streaming.
  Complexity: large.
  Dependencies: hardware/source/credential decisions.
  Independent: no.

- Task: Add Code Black Core production/overlay integration.
  Reason: overlays, OBS workflow, remote production, multistream, and archival belong on Core.
  Subsystem: Core/streaming.
  Complexity: large.
  Dependencies: Core backend design.
  Independent: no.

## Next Recommended Development Pass

1. Audit the real Raspberry Pi repo and live network/service configuration.
2. Approve and fix stale GPS refresh behavior for nearby/POI/spotters.
3. Decide credential/backup policy before wider field use.
4. Define the Pi stream status/control API contract.
5. Only then build the tablet streaming panels.
