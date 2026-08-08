# Code Black Telemetry — Changelog

All changes logged newest-first.

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
