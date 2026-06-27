/**
 * Telemetry Provider Entry Point
 *
 * To swap simulated data for the real Raspberry Pi API:
 *   1. Implement TelemetryProvider in a new file (e.g. api-provider.ts or ws-provider.ts)
 *   2. Replace `new SimulatorProvider()` below with your real provider
 *   3. No UI components need to change
 */
import { SimulatorProvider } from "./simulator";
import type { TelemetryProvider } from "./types";

export type { TelemetryProvider, TelemetrySnapshot } from "./types";

// Swap this line to connect to the Pi
const provider: TelemetryProvider = new SimulatorProvider();

export default provider;
