# Code Black Telemetry — Changelog

All changes logged newest-first.

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
