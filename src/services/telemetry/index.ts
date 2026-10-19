/**
 * Telemetry Provider Entry Point
 *
 * Hybrid provider:
 *   1. Polls the Raspberry Pi API when VITE_PI_API_BASE is configured or same-origin proxying exists
 *   2. Falls back to honest tablet/offline states without blocking the UI
 *   3. Lets the app shell inject tablet GPS when vehicle GPS is stale/unavailable
 */
import { HybridTelemetryProvider } from "./api-provider";
import type { TabletLocationInput, TelemetryProvider } from "./types";

export type { TelemetryProvider, TelemetrySnapshot, TabletLocationInput } from "./types";

const provider = new HybridTelemetryProvider();

export function setTabletLocation(location: TabletLocationInput | null) {
  provider.setTabletLocation(location);
}

export function setTelemetryPaused(paused: boolean) {
  provider.setPaused(paused);
}

export default provider satisfies TelemetryProvider;
