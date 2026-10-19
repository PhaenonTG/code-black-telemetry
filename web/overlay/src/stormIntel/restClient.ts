import type { LiveConfig } from "../config/liveConfig";
import { normalizeStormIntelSnapshot } from "./normalize";
import type { StormIntelSnapshot } from "./types";

export class StormIntelTransportError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StormIntelTransportError";
  }
}

/** Builds the real Core REST path for the configured context -- exact routes from
 * `code_black_core_api/app.py`, never invented. */
export function stormIntelRestPath(config: LiveConfig): string {
  if (config.contextType === "SELECTED_TARGET") {
    if (config.latitude === null || config.longitude === null) {
      throw new StormIntelTransportError("SELECTED_TARGET requires latitude/longitude");
    }
    return `/api/storm-intel/v1/point?latitude=${config.latitude}&longitude=${config.longitude}`;
  }
  if (!config.unitId) {
    throw new StormIntelTransportError(`${config.contextType} requires unitId`);
  }
  if (config.contextType === "AHEAD_OF_UNIT") {
    const distance = config.aheadDistanceMiles ?? 20;
    return `/api/storm-intel/v1/contexts/unit/${encodeURIComponent(config.unitId)}/ahead?distance_miles=${distance}`;
  }
  return `/api/storm-intel/v1/contexts/unit/${encodeURIComponent(config.unitId)}`;
}

export function stormIntelWsUrl(config: LiveConfig): string {
  const params = new URLSearchParams();
  if (config.contextType === "SELECTED_TARGET") {
    if (config.latitude === null || config.longitude === null) {
      throw new StormIntelTransportError("SELECTED_TARGET requires latitude/longitude");
    }
    params.set("latitude", String(config.latitude));
    params.set("longitude", String(config.longitude));
  } else {
    if (!config.unitId) {
      throw new StormIntelTransportError(`${config.contextType} requires unitId`);
    }
    params.set("unit_id", config.unitId);
    if (config.contextType === "AHEAD_OF_UNIT") {
      params.set("distance_miles", String(config.aheadDistanceMiles ?? 20));
    }
  }
  params.set("poll_seconds", String(config.pollSeconds));
  return `${config.coreWsUrl}/api/storm-intel/v1/ws?${params.toString()}`;
}

/** One REST bootstrap fetch. Throws `StormIntelTransportError` on network failure, non-2xx, or a
 * malformed body (wraps `StormIntelNormalizationError`) -- callers treat both as "unavailable",
 * never as a reason to fall back to simulated data. */
export async function fetchStormIntelSnapshot(
  config: LiveConfig,
  signal?: AbortSignal,
): Promise<StormIntelSnapshot> {
  const path = stormIntelRestPath(config);
  let response: Response;
  try {
    response = await fetch(`${config.coreBaseUrl}${path}`, { signal });
  } catch (error) {
    throw new StormIntelTransportError(`network error fetching ${path}`, error);
  }
  if (!response.ok) {
    throw new StormIntelTransportError(`${path} returned HTTP ${response.status}`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new StormIntelTransportError(`${path} returned non-JSON body`, error);
  }
  try {
    return normalizeStormIntelSnapshot(body);
  } catch (error) {
    throw new StormIntelTransportError(`${path} returned a malformed snapshot`, error);
  }
}
