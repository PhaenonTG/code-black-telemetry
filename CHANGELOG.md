# Code Black Telemetry — Changelog

All changes logged newest-first.

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
