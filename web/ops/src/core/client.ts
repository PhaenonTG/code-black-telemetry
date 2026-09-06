import { normalizeStormIntelSnapshot } from "../../../../web/overlay/src/stormIntel/normalize";
import type { StormIntelSnapshot } from "../../../../web/overlay/src/stormIntel/types";
import type { FabricNormalizedState } from "../../../../src/services/fabric";
import { coreConfigured, type OpsCoreConfig } from "./config";
import type { CoreHealthSnapshot, FabricSnapshotState, OpsConnectionState, StormIntelState } from "./types";

const REQUEST_TIMEOUT_MS = 5_000;

export class OpsCoreClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpsCoreClientError";
  }
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new OpsCoreClientError(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await work(controller.signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new OpsCoreClientError("request timeout");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function unavailableState(config: OpsCoreConfig, label: string): { state: OpsConnectionState; detail: string } {
  if (config.mode === "SIMULATION") return { state: "DEVELOPMENT", detail: `${label} disabled in explicit simulation mode` };
  if (!coreConfigured(config)) return { state: "UNAVAILABLE", detail: "CodeBlack-Core URL is not configured for this browser build" };
  return { state: "UNAVAILABLE", detail: `${label} unavailable` };
}

export async function fetchCoreHealth(config: OpsCoreConfig): Promise<CoreHealthSnapshot> {
  const now = Date.now();
  const unavailable = unavailableState(config, "Core health");
  if (!coreConfigured(config)) return { ...unavailable, checkedAt: now };
  try {
    const body = await withTimeout((signal) => fetchJson<unknown>(`${config.coreBaseUrl}/health`, signal));
    const status = typeof body === "object" && body !== null && "status" in body ? String((body as { status?: unknown }).status) : "ok";
    return { state: /ok|healthy|ready|live/i.test(status) ? "LIVE" : "DEGRADED", detail: `Core /health responded: ${status}`, checkedAt: Date.now() };
  } catch (error) {
    return {
      state: "UNAVAILABLE",
      detail: error instanceof Error ? `Core /health failed: ${error.message}` : "Core /health failed",
      checkedAt: Date.now(),
    };
  }
}

export async function fetchFabricState(config: OpsCoreConfig, previous?: Pick<FabricSnapshotState, "wsState" | "lastWsEventAt">): Promise<FabricSnapshotState> {
  const now = Date.now();
  const unavailable = unavailableState(config, "Fabric");
  if (!coreConfigured(config)) {
    return { ...unavailable, checkedAt: now, health: null, units: null, wsState: "disabled", lastWsEventAt: null };
  }
  try {
    const [health, units] = await Promise.all([
      withTimeout((signal) => fetchJson<unknown>(`${config.coreBaseUrl}/api/fabric/v1/health`, signal)),
      withTimeout((signal) => fetchJson<FabricNormalizedState>(`${config.coreBaseUrl}/api/fabric/v1/units`, signal)),
    ]);
    const unitCount = Array.isArray(units.units) ? units.units.length : 0;
    return {
      state: "LIVE",
      detail: `Fabric REST ready; ${unitCount} registered unit${unitCount === 1 ? "" : "s"}`,
      checkedAt: Date.now(),
      health,
      units,
      wsState: previous?.wsState ?? "disabled",
      lastWsEventAt: previous?.lastWsEventAt ?? null,
    };
  } catch (error) {
    return {
      state: "UNAVAILABLE",
      detail: error instanceof Error ? `Fabric REST failed: ${error.message}` : "Fabric REST failed",
      checkedAt: Date.now(),
      health: null,
      units: null,
      wsState: previous?.wsState ?? "disabled",
      lastWsEventAt: previous?.lastWsEventAt ?? null,
    };
  }
}

export async function fetchStormIntelHealth(config: OpsCoreConfig, point: { lat: number; lon: number } | null): Promise<StormIntelState> {
  const now = Date.now();
  const unavailable = unavailableState(config, "Storm Intel");
  if (!coreConfigured(config)) {
    return { ...unavailable, checkedAt: now, health: null, selectedPoint: point, pointSnapshot: null, pointError: null };
  }

  let health: unknown | null = null;
  let pointSnapshot: StormIntelSnapshot | null = null;
  let pointError: string | null = null;
  try {
    health = await withTimeout((signal) => fetchJson<unknown>(`${config.coreBaseUrl}/api/storm-intel/v1/health`, signal));
  } catch (error) {
    return {
      state: "UNAVAILABLE",
      detail: error instanceof Error ? `Storm Intel health failed: ${error.message}` : "Storm Intel health failed",
      checkedAt: Date.now(),
      health: null,
      selectedPoint: point,
      pointSnapshot: null,
      pointError: null,
    };
  }

  if (point) {
    try {
      const raw = await withTimeout((signal) =>
        fetchJson<unknown>(`${config.coreBaseUrl}/api/storm-intel/v1/point?latitude=${point.lat}&longitude=${point.lon}`, signal),
      );
      pointSnapshot = normalizeStormIntelSnapshot(raw);
    } catch (error) {
      pointError = error instanceof Error ? error.message : "point request failed";
    }
  }

  return {
    state: pointError ? "DEGRADED" : "LIVE",
    detail: point ? (pointSnapshot ? "Storm Intel point snapshot ready" : `Point snapshot unavailable: ${pointError}`) : "Storm Intel API ready; select a map point for quick intel",
    checkedAt: Date.now(),
    health,
    selectedPoint: point,
    pointSnapshot,
    pointError,
  };
}

export function fabricWsUrl(config: OpsCoreConfig): string {
  return `${config.coreWsUrl}/api/fabric/v1/ws`;
}
