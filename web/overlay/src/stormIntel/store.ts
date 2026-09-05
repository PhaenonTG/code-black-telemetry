import { useSyncExternalStore } from "react";
import { readLiveConfig } from "../config/liveConfig";
import { FIXTURES } from "./fixtures";
import { FixtureStormIntelProvider } from "./fixtureProvider";
import { RestStormIntelProvider } from "./liveProvider";
import { StormIntelSimulator } from "./simulator";
import type { OverlayMode, OverlayState, StormIntelProvider } from "./types";

/**
 * Single provider instance for the app. Mode is explicit and read once at module load from the
 * URL (`?mode=simulation|fixture|live_core`, default simulation) -- nothing here ever silently
 * upgrades or downgrades between modes at runtime. See
 * `docs/design/overlay-live-data-integration.md`.
 */
function createProvider(): { provider: StormIntelProvider; mode: OverlayMode } {
  const config = readLiveConfig();

  if (config.mode === "LIVE_CORE") {
    return { provider: new RestStormIntelProvider(config), mode: "LIVE_CORE" };
  }

  if (config.mode === "FIXTURE") {
    const sequence = config.fixture ? FIXTURES[config.fixture] : undefined;
    if (!sequence) {
      const known = Object.keys(FIXTURES).join(", ");
      throw new Error(`Unknown or missing ?fixture= name. Known fixtures: ${known}`);
    }
    return { provider: new FixtureStormIntelProvider(sequence), mode: "FIXTURE" };
  }

  return { provider: new StormIntelSimulator(config.contextType), mode: "SIMULATION" };
}

const { provider, mode } = createProvider();

export function useOverlayState(): OverlayState {
  return useSyncExternalStore(
    (listener) => provider.subscribe(listener),
    () => provider.getSnapshot(),
  );
}

export function getOverlayProvider(): StormIntelProvider {
  return provider;
}

/** Which data source is actually feeding the overlay right now -- dev/QA visibility only, never
 * rendered in the production broadcast chassis. See `DevControlPanel`. */
export function getOverlayMode(): OverlayMode {
  return mode;
}
