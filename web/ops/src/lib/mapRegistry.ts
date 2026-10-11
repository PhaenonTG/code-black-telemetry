import { supabase } from "./supabase";
import type { MapPinStatus, MapSourceRecord } from "../../../../src/services/mapSourceRegistry";

export interface MapSourceReview {
  id: number;
  source_id: string;
  status: MapPinStatus;
  findings: string;
  reviewer_id: string;
  reviewer_email: string;
  reviewed_at: string;
  next_review_at: string | null;
}

export interface RegisteredMapSource extends MapSourceRecord {
  first_seen_at: string;
  last_seen_at: string;
}

const DISCOVERY_BATCH_SIZE = 100;
const recentlyTouched = new Map<string, number>();

function validSource(source: MapSourceRecord): boolean {
  return source.id.length <= 240 && source.name.length > 0 &&
    Number.isFinite(source.latitude) && Number.isFinite(source.longitude) &&
    Math.abs(source.latitude) <= 90 && Math.abs(source.longitude) <= 180;
}

/** Refresh provider telemetry at most once per minute; preserve manual metadata corrections. */
export async function registerMapSources(sources: MapSourceRecord[]): Promise<void> {
  const now = Date.now();
  const pending = [...new Map(sources.filter(validSource).filter((source) => now - (recentlyTouched.get(source.id) ?? 0) >= 60_000).map((source) => [source.id, source])).values()];
  for (let offset = 0; offset < pending.length; offset += DISCOVERY_BATCH_SIZE) {
    const batch = pending.slice(offset, offset + DISCOVERY_BATCH_SIZE);
    const { error } = await supabase.rpc("register_map_sources", { payload: batch });
    if (error) throw error;
    batch.forEach((source) => recentlyTouched.set(source.id, now));
  }
}

export async function loadCurrentReviews(ids: string[]): Promise<Record<string, MapSourceReview>> {
  const unique = [...new Set(ids)].filter(Boolean);
  const reviews: Record<string, MapSourceReview> = {};
  for (let offset = 0; offset < unique.length; offset += DISCOVERY_BATCH_SIZE) {
    const { data, error } = await supabase.from("map_source_current_reviews")
      .select("source_id,id,status,findings,reviewer_id,reviewer_email,reviewed_at,next_review_at")
      .in("source_id", unique.slice(offset, offset + DISCOVERY_BATCH_SIZE));
    if (error) throw error;
    for (const review of (data ?? []) as MapSourceReview[]) reviews[review.source_id] = review;
  }
  return reviews;
}

export async function listMapSources(kind?: string, search?: string, offset = 0): Promise<{ rows: RegisteredMapSource[]; count: number }> {
  let query = supabase.from("map_sources").select("*", { count: "exact" })
    .order("last_seen_at", { ascending: false }).range(offset, offset + 99);
  if (kind && kind !== "all") query = query.eq("kind", kind);
  if (search?.trim()) {
    const sanitized = search.trim().replace(/[^\p{L}\p{N} _-]/gu, " ").slice(0, 80);
    query = query.or(`name.ilike.%${sanitized}%,city.ilike.%${sanitized}%,state.ilike.%${sanitized}%,provider_record_id.ilike.%${sanitized}%`);
  }
  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: (data ?? []) as RegisteredMapSource[], count: count ?? data?.length ?? 0 };
}

export async function listSourceHistory(sourceId: string): Promise<MapSourceReview[]> {
  const { data, error } = await supabase.from("map_source_reviews").select("*")
    .eq("source_id", sourceId).order("reviewed_at", { ascending: false }).limit(50);
  if (error) throw error;
  return (data ?? []) as MapSourceReview[];
}

export async function addSourceReview(sourceId: string, status: MapPinStatus, findings: string, nextReviewAt: string | null): Promise<void> {
  const { error } = await supabase.from("map_source_reviews")
    .insert({ source_id: sourceId, status, findings: findings.trim(), next_review_at: nextReviewAt });
  if (error) throw error;
}

export async function addManualLandmark(source: MapSourceRecord): Promise<void> {
  if (source.kind !== "landmark" || !validSource(source)) throw new Error("Invalid landmark");
  const { error } = await supabase.from("map_sources").insert(source);
  if (error) throw error;
}

export async function updateSourceLocation(sourceId: string, patch: { name: string; city: string | null; state: string | null; latitude: number; longitude: number; address: string | null }): Promise<void> {
  const { error } = await supabase.from("map_sources").update(patch).eq("id", sourceId);
  if (error) throw error;
}

export async function listLandmarks(): Promise<RegisteredMapSource[]> {
  const { data, error } = await supabase.from("map_sources").select("*").eq("kind", "landmark").limit(1000);
  if (error) throw error;
  return (data ?? []) as RegisteredMapSource[];
}
