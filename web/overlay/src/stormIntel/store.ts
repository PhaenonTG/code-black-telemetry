import { useSyncExternalStore } from "react";
import { StormIntelSimulator } from "./simulator";
import type { OverlayState, StormIntelProvider } from "./types";

/**
 * Single provider instance for the app, matching web/telemetry's
 * store.ts pattern. Swapping this line for a `RestStormIntelProvider`
 * is the entire migration path off simulation.
 */
const provider: StormIntelProvider = new StormIntelSimulator();

export function useOverlayState(): OverlayState {
  return useSyncExternalStore(
    (listener) => provider.subscribe(listener),
    () => provider.getSnapshot(),
  );
}

export function getOverlayProvider(): StormIntelProvider {
  return provider;
}
