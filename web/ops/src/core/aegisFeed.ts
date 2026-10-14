import { currentAccessToken } from "./client";
import type { OpsCoreConfig } from "./config";
import type { PolicyDraft, PolicyResult } from "../automation/policyLab";

export interface AegisRadarAlert {
  id: string;
  sequence: number;
  created_at: string;
  status: "supplemental_unconfirmed_radar_candidate";
  official_warning: { id: string; event: string; headline: string; expires: string; source_url: string };
  radar: { site: string; scan_time: string; volume_key: string; available_products: Record<string, boolean> };
  rating: { evidence_score: number; cutoff: number; calibrated_probability: null; factors: string[] };
  candidate: { coordinates: [number, number]; shearKt: number; reflectivityDbz: number; cc: number; zdrDb: number | null; tdsConfirmed: false };
  map: { type: "FeatureCollection"; features: unknown[] };
  disclaimer: string;
}

export interface AegisAlertFeed {
  schema: "codeblack.fabric.aegis-alert-feed.v1";
  state: "shadow" | "live";
  items: AegisRadarAlert[];
  next_cursor: number;
}

export interface AegisStatus {
  schema: "codeblack.fabric.aegis-status.v1";
  delivery_enabled: boolean;
  screen: { checked_at?: string; enabled?: boolean; cutoff?: number; warnings?: number;
    sites?: string[]; new_volumes?: number; qualified_alerts?: number; errors?: Array<{ site: string; message: string }> };
}

export interface AegisObservationPlan {
  schema: "codeblack.aegis.observation-plan.v1";
  generated_at: string;
  state: string;
  executor: {
    state: string;
    last_checked_at?: string | null;
    last_event_at?: string | null;
    last_event_kind?: string | null;
    notice?: string;
  };
  gates: Record<string, string>;
  live_chasers: unknown[];
  setup_drafts: Array<{ setup_id: string; risk?: string; cadence_minutes?: number }>;
  radar?: { available?: boolean; updated_at?: string; dominant_cell?: { available?: boolean; freshness_state?: string; last_error?: string | null } };
  official_storm_objects?: { state?: string };
  satellite?: { analysis_state?: string; state?: string; observed_at?: string; satellite?: string };
}

export interface AegisPolicyStatus {
  schema: "codeblack.aegis-policy-status.v1";
  live: { evidence_cutoff: number; delivery_enabled: boolean };
  current_draft: AegisPolicyRevision | null;
  revisions: AegisPolicyRevision[];
  activation_locked: boolean;
  drafts_affect_live_scanner: false;
}

export interface AegisPolicyRevision {
  revision: number;
  action: "baseline" | "draft" | "rollback";
  evidence_cutoff: number;
  actor: string;
  source_revision: number | null;
  created_at: string;
}

export interface AegisScenarioReplay extends PolicyResult {
  schema: "codeblack.aegis-policy-replay.v1";
  mode: "scenario";
  dry_run: true;
  no_messages_sent: true;
  no_config_changed: true;
}

export interface AegisRecordedReplay {
  schema: "codeblack.aegis-policy-replay.v1";
  mode: "recorded";
  dry_run: true;
  no_messages_sent: true;
  no_config_changed: true;
  evidence_cutoff: number;
  scans_reviewed: number;
  candidates_reviewed: number;
  limitation: string;
  scans: Array<{ site: string; volume_key: string; scan_time: string; processed_at: string;
    available_products: Record<string, boolean>; limitations: string[];
    candidates: Array<{ warning_id: string | null; coordinates: [number, number]; evidence_score: number | null;
      factors: string[]; decision: string }> }>;
}

async function coreGet<T>(config: OpsCoreConfig, route: string, signal?: AbortSignal): Promise<T> {
  if (!config.coreBaseUrl) throw new Error("Core is not configured");
  const token = await currentAccessToken();
  const response = await fetch(`${config.coreBaseUrl}${route}`, { cache: "no-store", signal,
    headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (!response.ok) throw new Error(`Core feed HTTP ${response.status}`);
  if (response.headers.get("content-type")?.toLowerCase().includes("text/html")) throw new Error("Aegis gateway returned a web page instead of data. Check Ops API routing.");
  try { return await response.json() as T; } catch { throw new Error("Aegis feed returned invalid data."); }
}

export function getAegisFeed(config: OpsCoreConfig, signal?: AbortSignal): Promise<AegisAlertFeed> {
  return coreGet(config, "/api/fabric/v1/aegis-alerts?after=0&limit=100", signal);
}

export function getAegisStatus(config: OpsCoreConfig, signal?: AbortSignal): Promise<AegisStatus> {
  return coreGet(config, "/api/fabric/v1/aegis-status", signal);
}

export function getAegisObservationPlan(config: OpsCoreConfig, signal?: AbortSignal): Promise<AegisObservationPlan> {
  return coreGet(config, "/api/fabric/v1/aegis-observation-plan", signal);
}

export function getAegisPolicy(config: OpsCoreConfig, signal?: AbortSignal): Promise<AegisPolicyStatus> {
  return coreGet(config, "/api/fabric/v1/aegis-policy", signal);
}

export async function replayAegisPolicy<T extends AegisScenarioReplay | AegisRecordedReplay>(
  config: OpsCoreConfig,
  input: { mode: "scenario"; scenario: PolicyDraft } | { mode: "recorded"; evidenceCutoff: number; limit: number },
  signal?: AbortSignal,
): Promise<T> {
  if (!config.coreBaseUrl) throw new Error("Core is not configured");
  const token = await currentAccessToken();
  const response = await fetch(`${config.coreBaseUrl}/api/fabric/v1/aegis-policy/replay`, {
    method: "POST", cache: "no-store", signal, body: JSON.stringify(input),
    headers: { Accept: "application/json", "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!response.ok) throw new Error(`Core replay HTTP ${response.status}`);
  if (response.headers.get("content-type")?.toLowerCase().includes("text/html")) throw new Error("Aegis gateway returned a web page instead of data. Check Ops API routing.");
  let result: T;
  try { result = await response.json() as T; } catch { throw new Error("Core replay returned invalid data."); }
  if (result.dry_run !== true || result.no_messages_sent !== true || result.no_config_changed !== true)
    throw new Error("Core did not confirm a side-effect-free replay");
  return result;
}
