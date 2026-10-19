# Code Black Control

Early frontend foundation for the future Code Black remote management and control plane.

This project is intentionally separate from the existing Code Black OPS/PiWX application. Code Black OPS remains the vehicle operational cockpit. Code Black Control is the future phone/tablet/laptop interface for system inventory, node status, service status, readiness, telemetry, streams, events, and safe control actions.

The current implementation is still simulation-only. It does not connect to the Raspberry Pi, BLE, Mapbox, radar, OBD, cameras, CodeBlack-Core, or any production telemetry/control service.

## Run

```powershell
cd "C:\Users\glenn\Documents\Code Black Telemetry\web\telemetry"
npm install
npm run dev
```

Vite serves the app at `http://127.0.0.1:5174` by default.

## Current Architecture

- `src/telemetry/types.ts` defines the UI-facing telemetry contract.
- `src/telemetry/simulator.ts` implements `TelemetryProvider` with realistic fake data.
- `src/telemetry/store.ts` exposes the active provider to React through `useSyncExternalStore`.
- `src/components/` contains reusable dashboard cards, metrics, top bar, status strip, and bottom navigation.
- `src/styles/theme.css` owns design tokens.
- `src/styles/app.css` owns layout and component styling.

The UI imports the provider contract through `src/telemetry/store.ts`, not directly from simulator internals. A future Raspberry Pi or CodeBlack-Core integration should add a provider class that implements the same subscription model:

```ts
class RestTelemetryProvider implements TelemetryProvider {
  subscribe(listener: () => void): () => void;
  getSnapshot(): TelemetrySnapshot;
  setMode(mode: SimulationMode): void;
  disconnect(): void;
}
```

REST polling and WebSocket streaming can both fit behind this interface. REST would poll the Pi/Core API and publish snapshots on response. WebSocket would publish snapshots as messages arrive and update connection health on close/retry. Dashboard components should not need to change as long as the provider returns the same normalized shape.

## Product Direction

Code Black Control should evolve toward:

- system inventory
- node status
- service status
- chase readiness
- telemetry drilldowns
- stream status and safe controls
- event/audit log
- settings

It should not become another full chase cockpit. Maps, radar, tactical chasing controls, and vehicle-first cockpit workflows belong in Code Black OPS unless a specific control-plane view is approved.

## Future Navigation

Planned control-plane navigation:

- Dashboard
- Nodes
- Services
- Telemetry
- Streams
- Events
- Settings

Weather, Wind, and GPS can remain telemetry drilldowns, but they should support system diagnosis and remote status rather than duplicating the OPS cockpit.

## Simulation Modes

The Settings card has three local modes:

- `LIVE`: wind, GPS, weather, power, system health, and sensor timestamps advance every second.
- `STALE`: values stop advancing while connection health degrades and data age increases.
- `OFFLINE`: values remain last-known, sensors report offline, and overall health becomes critical.

These modes are meant to exercise the UI states that will matter before real Pi/Core providers are connected.

## Current Boundaries

Included:

- Dashboard page
- Wind, weather, GPS, status strip, sensor health, power, system, and recent events
- Bottom navigation labels for Dashboard, Wind, Weather, GPS, System, Settings
- Responsive landscape tablet layout
- Lightweight theme tokens
- Simulated telemetry provider boundary

Excluded until later phases or explicit product approval:

- Maps
- Radar
- OBD
- Cameras
- Chase Mode
- Raspberry Pi API/WebSocket connection
- Service start/stop/restart actions
- Pi reboot
- Authenticated control-plane backend
