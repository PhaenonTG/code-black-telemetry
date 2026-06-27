# Code Black Telemetry — Architecture

## Overview

A vehicle operations dashboard built for a Samsung Galaxy Tab running in landscape kiosk mode.
Phase 1 uses simulated data. The telemetry layer is designed for a clean swap to the Raspberry Pi backend.

## Stack

| Layer       | Technology                        |
|-------------|-----------------------------------|
| Frontend    | React 19 + TypeScript + Vite      |
| Styling     | Tailwind CSS v3                   |
| Routing     | React Router v6                   |
| State       | Zustand (single telemetry store)  |
| Data        | SimulatorProvider (Phase 1)       |

## Folder Structure

```
src/
├── components/
│   ├── cards/        # Individual dashboard cards (Wind, Weather, GPS, etc.)
│   ├── layout/       # TopBar, StatusStrip, BottomNav
│   └── ui/           # Primitives: DashCard, MetricRow, StatusBadge
├── hooks/
│   └── useTelemetry.ts   # Zustand store + per-slice selector hooks
├── pages/            # Full-page views for each nav tab
├── services/
│   └── telemetry/
│       ├── types.ts       # All data types / TelemetryProvider interface
│       ├── simulator.ts   # Fake data generator (Phase 1)
│       └── index.ts       # ← SWAP POINT: change provider here for Phase 2
└── App.tsx           # Router + layout shell
```

## Swapping Simulated Data for the Raspberry Pi

All UI components subscribe to data through `useTelemetry` hooks. The hooks read from a Zustand
store that is fed by whichever `TelemetryProvider` is exported from `src/services/telemetry/index.ts`.

### To connect to the Pi REST API:

1. Create `src/services/telemetry/api-provider.ts` implementing `TelemetryProvider`
2. Poll `GET /api/telemetry` on the Pi at a fixed interval
3. In `index.ts`, replace:
   ```ts
   const provider: TelemetryProvider = new SimulatorProvider();
   ```
   with:
   ```ts
   const provider: TelemetryProvider = new ApiProvider("http://<PI_IP>:8000");
   ```

### To connect via WebSocket:

1. Create `src/services/telemetry/ws-provider.ts` implementing `TelemetryProvider`
2. Subscribe to `ws://<PI_IP>:8000/ws/telemetry`
3. Swap the provider in `index.ts` the same way

No UI component changes are needed.

## TelemetryProvider Interface

```ts
interface TelemetryProvider {
  subscribe(callback: (snapshot: TelemetrySnapshot) => void): () => void;
  getLatest(): TelemetrySnapshot;
  disconnect(): void;
}
```

## Deployment Targets

| Target           | Notes                                    |
|------------------|------------------------------------------|
| Dev (Windows)    | `npm run dev` — hot reload               |
| Tablet (Android) | `npm run build` → APK WebView (Phase 3)  |
| Pi (headless)    | Backend only — no browser on Pi          |

## Design Constraints

- No expensive CSS (no heavy blur, no shadows on every element)
- Landscape-first layout (4-column grid on dashboard)
- Monospace fonts for all telemetry values (tabular-nums)
- Color-coded status: green=ok, amber=warn, red=critical
- No unnecessary re-renders (Zustand slice selectors)
