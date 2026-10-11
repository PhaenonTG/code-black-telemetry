import { currentAccessToken } from "./client";
import type { OpsCoreConfig } from "./config";

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

async function coreGet<T>(config: OpsCoreConfig, route: string, signal?: AbortSignal): Promise<T> {
  if (!config.coreBaseUrl) throw new Error("Core is not configured");
  const token = await currentAccessToken();
  const response = await fetch(`${config.coreBaseUrl}${route}`, { cache: "no-store", signal,
    headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (!response.ok) throw new Error(`Core feed HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export function getAegisFeed(config: OpsCoreConfig, signal?: AbortSignal): Promise<AegisAlertFeed> {
  return coreGet(config, "/api/fabric/v1/aegis-alerts?after=0&limit=100", signal);
}

export function getAegisStatus(config: OpsCoreConfig, signal?: AbortSignal): Promise<AegisStatus> {
  return coreGet(config, "/api/fabric/v1/aegis-status", signal);
}
