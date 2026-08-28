import { useSyncExternalStore } from "react";
import { SimulatorTelemetryProvider } from "./simulator";
import type { SimulationMode, TelemetrySnapshot } from "./types";

const provider = new SimulatorTelemetryProvider();

export function useTelemetrySnapshot(): TelemetrySnapshot {
  return useSyncExternalStore(
    (listener) => provider.subscribe(listener),
    () => provider.getSnapshot(),
    () => provider.getSnapshot(),
  );
}

export function setSimulationMode(mode: SimulationMode) {
  provider.setMode(mode);
}

export type { SimulationMode, TelemetrySnapshot };
