import type { ContextType, OverlayMode } from "../stormIntel/types";

export interface LiveConfig {
  mode: OverlayMode;
  /** e.g. "https://core.codeblackwx.example" -- no trailing slash. */
  coreBaseUrl: string;
  /** e.g. "wss://core.codeblackwx.example" -- no trailing slash. */
  coreWsUrl: string;
  contextType: ContextType;
  unitId: string | null;
  aheadDistanceMiles: number | null;
  latitude: number | null;
  longitude: number | null;
  /** Configured human display identity, e.g. "Spencer". Never the internal fleet unit ID
   * (`cbwx-unit-striker`/`cbwx-unit-tessa`) -- see `resolvePublicIdentity` in `publicIdentity.ts`. */
  publicIdentity: string | null;
  /** Recorded fixture name when mode is FIXTURE. */
  fixture: string | null;
  reconnectMinMs: number;
  reconnectMaxMs: number;
  /** Passed to Core's WS as `poll_seconds` -- how often it re-sends the snapshot. Server allows
   * 1-300; default matches Core's own default (30s). */
  pollSeconds: number;
}

const DEFAULTS: LiveConfig = {
  mode: "SIMULATION",
  coreBaseUrl: "",
  coreWsUrl: "",
  contextType: "AT_UNIT",
  unitId: null,
  aheadDistanceMiles: null,
  latitude: null,
  longitude: null,
  publicIdentity: null,
  fixture: null,
  reconnectMinMs: 2000,
  reconnectMaxMs: 30000,
  pollSeconds: 30,
};

function parseMode(value: string | null): OverlayMode {
  if (value === "live_core" || value === "LIVE_CORE") return "LIVE_CORE";
  if (value === "fixture" || value === "FIXTURE") return "FIXTURE";
  return "SIMULATION";
}

function parseContextType(value: string | null): ContextType {
  if (value === "AHEAD_OF_UNIT" || value === "SELECTED_TARGET") return value;
  return "AT_UNIT";
}

function parseNumber(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Reads live-Core/mode configuration from the URL, matching `overlayConfig.ts`'s pattern.
 * Explicit only -- SIMULATION is the default and nothing ever silently upgrades itself to
 * LIVE_CORE. Example:
 * `?mode=live_core&coreBaseUrl=https://core.example&coreWsUrl=wss://core.example&unitId=cbwx-unit-striker`
 */
export function readLiveConfig(search: string = window.location.search): LiveConfig {
  const params = new URLSearchParams(search);
  return {
    mode: parseMode(params.get("mode")),
    coreBaseUrl: params.get("coreBaseUrl") ?? DEFAULTS.coreBaseUrl,
    coreWsUrl: params.get("coreWsUrl") ?? DEFAULTS.coreWsUrl,
    contextType: parseContextType(params.get("context")),
    unitId: params.get("unitId") ?? DEFAULTS.unitId,
    aheadDistanceMiles: parseNumber(params.get("aheadDistanceMiles")),
    latitude: parseNumber(params.get("latitude")),
    longitude: parseNumber(params.get("longitude")),
    publicIdentity: params.get("publicIdentity") ?? DEFAULTS.publicIdentity,
    fixture: params.get("fixture") ?? DEFAULTS.fixture,
    reconnectMinMs: parseNumber(params.get("reconnectMinMs")) ?? DEFAULTS.reconnectMinMs,
    reconnectMaxMs: parseNumber(params.get("reconnectMaxMs")) ?? DEFAULTS.reconnectMaxMs,
    pollSeconds: parseNumber(params.get("pollSeconds")) ?? DEFAULTS.pollSeconds,
  };
}
