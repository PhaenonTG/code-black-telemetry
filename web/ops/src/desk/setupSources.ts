import { buildCoreRequestHeaders, currentAccessToken, OpsCoreClientError } from "../core/client"
import type { OpsCoreConfig } from "../core/config"
import { validateSetupDraft, validateSetupIndex } from "./setupValidation"

export type SetupIndex = {
  status: string
  checked_at: string | null
  last_source_check_at?: string | null
  items: Array<{ setup_id: string; revision: number; valid_from: string; valid_until: string; generated_at: string; risk_label: string; day: number; model_status: string; review_required: boolean }>
}
export type SetupDraft = {
  setup_id: string; revision: number; generated_at: string; valid_from: string; valid_until: string
  summary: string; bounds: [number, number, number, number]
  official: { risk_label: string; source_url: string; issued_at: string }
  model: { status: string; source: string; notice: string; target_points: Array<{ latitude: number; longitude: number; valid_time: string; run_time: string; score_index: number; classification: string }> }
  review: { required: boolean; decision: string | null; reason: string }
  tornado_tracking_map?: {
    schema: string; status: string; boundary_source: string; source_url: string | null
    issued_at: string | null; valid_from: string; valid_until: string
    aegis_status: string; aegis_summary: string | null; numeric_point_samples: number
    matched_numeric_fields: number; notice: string
    setup_focus_numeric_lead: { lead_model: string; valid_time: string } | null
    features: Array<{ type: "Feature"; geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] }; properties: { official_risk_label: string; official_risk_code: number; tracking_state: string; numeric_model_context: boolean } }>
  }
}

async function get<T>(config: OpsCoreConfig, path: string, signal?: AbortSignal): Promise<T> {
  const token = await currentAccessToken()
  const response = await fetch(`${config.coreBaseUrl}/api/forecast/v1/${path}`, { signal, cache: "no-store", headers: buildCoreRequestHeaders(token) })
  if (!response.ok) throw new OpsCoreClientError(`Setup source HTTP ${response.status}`)
  return response.json() as Promise<T>
}
export const loadSetupIndex = async (config: OpsCoreConfig, signal?: AbortSignal) => validateSetupIndex(await get<unknown>(config, "chase-setups", signal))
export const loadSetupDraft = async (config: OpsCoreConfig, id: string, signal?: AbortSignal) => validateSetupDraft(await get<unknown>(config, `chase-setup?setup_id=${encodeURIComponent(id)}`, signal), id)
