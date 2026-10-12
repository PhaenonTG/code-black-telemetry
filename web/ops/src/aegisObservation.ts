import { buildCoreRequestHeaders, currentAccessToken, OpsCoreClientError } from "./core/client"
import type { OpsCoreConfig } from "./core/config"

export type AegisObservationPlan = {
  state: "gated" | "ready_for_executor"
  generated_at: string
  gates: Record<string, string>
  live_chasers: Array<{ unit_id?: string; display_name?: string; role?: string; cadence_minutes?: number; last_seen?: string | null }>
  setup_drafts: Array<{ setup_id: string; risk?: string | null; valid_from?: string | null; cadence_minutes?: number; radar_context?: { status?: string }; model_context?: { status?: string } }>
  radar: { available?: boolean; updated_at?: string | null; products?: Record<string, RadarProductEvidence>; dominant_cell?: DominantCellEvidence | null; official_storm_objects?: OfficialStormObjects }
  model_policy: { current: string; current_sources: string[]; gap: string }
  verification: { state: string; rule: string; notice: string }
  satellite: { state: string; target?: string; rule: string; satellite?: string; product?: string; observed_at?: string | null; source_url?: string; analysis_state?: string; notice?: string }
  executor: { state: string; notice: string }
}

export type RadarProductEvidence = { available?: boolean; trustworthy?: boolean; freshness_state?: string; site_id?: string | null; frame_id?: string | null; observed_at?: string | null; quality?: string | null; source?: string | null }
export type DominantCellEvidence = {
  id?: string | null; available?: boolean; site_id?: string | null; location?: { lat?: number; lon?: number } | null
  max_dbz?: number | null; speed_knots?: number | null; direction_degrees?: number | null; confidence?: string | null
  sample_span_minutes?: number | null; observed_at?: string | null; freshness_state?: string; trustworthy?: boolean
  source?: string | null; last_error?: string | null
}

export type OfficialStormObjects = {
  state?: "available" | "unavailable" | string
  source?: string
  retrieved_at?: string | null
  object_count?: number
  notice?: string
  sources?: Record<string, { status?: string; time?: string | null }>
  storm_tracking?: Array<{
    id?: string
    movement?: { deg?: number; kts?: number } | null
    forecast?: Array<{ leadMinutes?: number; status?: string | null; position?: { lat?: number; lon?: number } | null }>
  }>
  mesocyclones?: Array<{
    id?: string
    stormId?: string | null
    tornadicVortexSignature?: boolean
    motion?: { deg?: number; kts?: number } | false | null
    mesocycloneStrengthIndex?: number | string | null
  }>
}

export async function loadAegisObservationPlan(config: OpsCoreConfig, signal?: AbortSignal): Promise<AegisObservationPlan> {
  const token = await currentAccessToken()
  const response = await fetch(`${config.coreBaseUrl}/api/fabric/v1/aegis-observation-plan`, {
    cache: "no-store",
    signal,
    headers: buildCoreRequestHeaders(token),
  })
  if (!response.ok) throw new OpsCoreClientError(`HTTP ${response.status}`)
  return response.json() as Promise<AegisObservationPlan>
}
