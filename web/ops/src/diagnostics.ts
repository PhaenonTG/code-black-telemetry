import type { OpsCoreConfig } from "./core/config";
import { readOpsCoreConfig } from "./core/config";
import { supabase } from "./lib/supabase";

export type OpsIncident = {
  id: string; created_at: string; source: "BROWSER" | "OPS_GATEWAY" | "CORE";
  severity: "INFO" | "WARN" | "ERROR"; subsystem: string; action: string; result: string;
  trace_id: string; message?: string | null; release?: string | null; latency_ms?: number | null;
  verified_at?: string | null; verification_note?: string | null;
};

export function newTraceId(): string { return `ops-${crypto.randomUUID()}`; }

async function request<T>(config: OpsCoreConfig, path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? null;
  const trace = init.headers && "X-CodeBlack-Trace-Id" in init.headers ? String((init.headers as Record<string, string>)["X-CodeBlack-Trace-Id"]) : newTraceId();
  const response = await fetch(`${config.coreBaseUrl}${path}`, { ...init, cache: "no-store", headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), "X-CodeBlack-Trace-Id": trace, ...init.headers } });
  if (!response.ok) throw new Error(`Diagnostics request failed: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export async function loadOpsIncidents(config: OpsCoreConfig, severity?: OpsIncident["severity"]): Promise<OpsIncident[]> {
  const params = new URLSearchParams({ limit: "100" }); if (severity) params.set("severity", severity);
  const body = await request<{ events?: OpsIncident[] }>(config, `/api/ops/v1/incidents?${params}`);
  return Array.isArray(body.events) ? body.events : [];
}

export async function recordOpsIncident(config: OpsCoreConfig, incident: Omit<OpsIncident, "id" | "created_at" | "verified_at" | "verification_note">): Promise<void> {
  await request(config, "/api/ops/v1/incidents", { method: "POST", headers: { "Content-Type": "application/json", "X-CodeBlack-Trace-Id": incident.trace_id }, body: JSON.stringify(incident) });
}

export async function verifyOpsIncident(config: OpsCoreConfig, incidentId: string): Promise<void> {
  await request(config, "/api/ops/v1/incidents/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ incident_id: incidentId, note: "Verified from OPS diagnostics" }) });
}

export function installBrowserDiagnostics(config: OpsCoreConfig): void {
  if (!config.coreBaseUrl || sessionStorage.getItem("cbwx-diagnostics-installed")) return;
  sessionStorage.setItem("cbwx-diagnostics-installed", "1");
  const sent = new Set<string>();
  const capture = (action: string, message: string) => {
    const key = `${action}:${message}`.slice(0, 320); if (sent.has(key)) return; sent.add(key);
    void recordOpsIncident(config, { source: "BROWSER", severity: "ERROR", subsystem: "OPS_UI", action, result: "FAILED", trace_id: newTraceId(), message: key, release: import.meta.env.VITE_CF_PAGES_COMMIT_SHA as string | undefined, latency_ms: null }).catch(() => undefined);
  };
  window.addEventListener("error", (event) => capture("WINDOW_ERROR", event.message || "Unhandled browser error"));
  window.addEventListener("unhandledrejection", (event) => capture("UNHANDLED_REJECTION", event.reason instanceof Error ? event.reason.message : "Unhandled promise rejection"));
}

export function reportCoreRequestFailure(action: string, message: string, latencyMs: number, traceId: string = newTraceId()): void {
  const config = readOpsCoreConfig();
  if (!config.coreBaseUrl) return;
  void recordOpsIncident(config, {
    source: "BROWSER", severity: "ERROR", subsystem: "CORE_REQUEST", action,
    result: "FAILED", trace_id: traceId, message, latency_ms: Math.max(0, Math.round(latencyMs)),
    release: import.meta.env.VITE_CF_PAGES_COMMIT_SHA as string | undefined,
  }).catch(() => undefined);
}
