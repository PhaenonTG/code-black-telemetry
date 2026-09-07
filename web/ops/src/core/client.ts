import { normalizeStormIntelSnapshot } from "../../../../web/overlay/src/stormIntel/normalize";
import type { StormIntelSnapshot } from "../../../../web/overlay/src/stormIntel/types";
import type { FabricNormalizedState } from "../../../../src/services/fabric";
import { supabase } from "../lib/supabase";
import { coreConfigured, type OpsCoreConfig } from "./config";
import type { CoreHealthSnapshot, FabricSnapshotState, OpsConnectionState, StormIntelState } from "./types";

const REQUEST_TIMEOUT_MS = 10_000;
// The point-intel lookup does a real HRRR grid interpolation on Core's side (through the VPC
// gateway hop too), not a cheap health check -- 10s was tight enough to time out on a normal, if
// slow, response rather than a genuinely hung request.
const POINT_REQUEST_TIMEOUT_MS = 25_000;

export class OpsCoreClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpsCoreClientError";
  }
}

export interface FabricWsEvent {
  eventType: string;
  timestamp: string | null;
  payload: unknown;
}

// The production gateway (web/ops/functions/api/core) requires this on every request; the local
// dev SSH-tunnel path (Core reached directly, no gateway in front) ignores it harmlessly since
// Core's own API has no auth check. Reads the current Supabase session fresh on every call rather
// than caching it -- supabase-js keeps this in-memory/localStorage and transparently refreshes it,
// so this always reflects the current token (including right after a refresh) with no extra
// network round trip of its own. Returns null for "no session" and "expired with failed refresh"
// alike; both cases correctly fall through to the gateway's own 401, which each caller below
// already surfaces as an honest UNAVAILABLE detail rather than fabricating a different failure.
export async function currentAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export function buildCoreRequestHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const token = await currentAccessToken();
  const response = await fetch(url, {
    cache: "no-store",
    signal,
    headers: buildCoreRequestHeaders(token),
  });
  if (!response.ok) throw new OpsCoreClientError(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, outerSignal?: AbortSignal, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  outerSignal?.addEventListener("abort", abort, { once: true });
  try {
    return await work(controller.signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new OpsCoreClientError(outerSignal?.aborted ? "request cancelled" : "request timeout");
    }
    throw error;
  } finally {
    outerSignal?.removeEventListener("abort", abort);
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

export async function fetchFabricRest(config: OpsCoreConfig, previous?: Pick<FabricSnapshotState, "wsState" | "lastWsEventAt" | "lastContactAt" | "error">): Promise<FabricSnapshotState> {
  const now = Date.now();
  const unavailable = unavailableState(config, "Fabric");
  if (!coreConfigured(config)) {
    return { ...unavailable, checkedAt: now, health: null, units: null, wsState: "disabled", lastWsEventAt: null, lastContactAt: null, error: null };
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
      lastContactAt: Date.now(),
      error: previous?.error ?? null,
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
      lastContactAt: previous?.lastContactAt ?? null,
      error: error instanceof Error ? error.message : "Fabric REST failed",
    };
  }
}

export async function fetchStormIntelHealth(config: OpsCoreConfig): Promise<Pick<StormIntelState, "state" | "detail" | "checkedAt" | "health">> {
  const now = Date.now();
  const unavailable = unavailableState(config, "Storm Intel");
  if (!coreConfigured(config)) return { ...unavailable, checkedAt: now, health: null };
  try {
    const health = await withTimeout((signal) => fetchJson<unknown>(`${config.coreBaseUrl}/api/storm-intel/v1/health`, signal));
    return { state: "LIVE", detail: "Storm Intel API ready", checkedAt: Date.now(), health };
  } catch (error) {
    return {
      state: "UNAVAILABLE",
      detail: error instanceof Error ? `Storm Intel health failed: ${error.message}` : "Storm Intel health failed",
      checkedAt: Date.now(),
      health: null,
    };
  }
}

export async function fetchStormIntelPoint(config: OpsCoreConfig, point: { lat: number; lon: number }, signal?: AbortSignal): Promise<StormIntelSnapshot> {
  if (!coreConfigured(config)) throw new OpsCoreClientError(unavailableState(config, "Storm Intel point").detail);
  const params = new URLSearchParams({ latitude: String(point.lat), longitude: String(point.lon) });
  const raw = await withTimeout((timeoutSignal) => fetchJson<unknown>(`${config.coreBaseUrl}/api/storm-intel/v1/point?${params}`, timeoutSignal), signal, POINT_REQUEST_TIMEOUT_MS);
  return normalizeStormIntelSnapshot(raw);
}

export function normalizeFabricWsEvent(raw: string): FabricWsEvent {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new OpsCoreClientError("Malformed Fabric WebSocket JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new OpsCoreClientError("Malformed Fabric WebSocket event");
  const record = body as Record<string, unknown>;
  const eventType = typeof record.event_type === "string" ? record.event_type : "";
  if (!eventType) throw new OpsCoreClientError("Fabric WebSocket event missing event_type");
  return {
    eventType,
    timestamp: typeof record.timestamp === "string" ? record.timestamp : null,
    payload: record.payload,
  };
}

export function fabricWsUrl(config: OpsCoreConfig): string {
  return `${config.coreWsUrl}/api/fabric/v1/ws`;
}
