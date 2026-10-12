import { buildCoreRequestHeaders, currentAccessToken, OpsCoreClientError } from "./core/client"
import type { OpsCoreConfig } from "./core/config"

export type LocalAiAssessment = {
  status: "available" | "degraded" | "unavailable"
  generated_at: string
  assessment_generated_at?: string | null
  age_seconds?: number | null
  latency_ms?: number | null
  reason?: string | null
  guard_reasons?: string[]
  snapshot_id?: string | null
  valid_for_seconds?: number | null
  model?: { name?: string; host?: string; ollama_model?: string }
  context?: { unit_id?: string | null; context_type?: string | null } | null
  assessment?: Record<string, unknown> | null
}

export type TargetAiAnalysis = {
  status: "available" | "degraded" | "unavailable"
  generated_at: string
  latency_ms?: number | null
  reason?: string | null
  guard_reasons?: string[]
  snapshot_id?: string | null
  model?: { name?: string; host?: string; ollama_model?: string }
  context: { latitude: number; longitude: number; context_type: "SELECTED_TARGET" }
  assessment?: Record<string, unknown> | null
  radar_evidence: Record<string, unknown>
}

async function request(config: OpsCoreConfig, method: "GET" | "POST", suffix: string, signal?: AbortSignal): Promise<LocalAiAssessment> {
  const token = await currentAccessToken()
  const response = await fetch(`${config.coreBaseUrl}/api/ai/v1/assessment${suffix}`, {
    method,
    signal,
    cache: "no-store",
    headers: buildCoreRequestHeaders(token),
  })
  if (!response.ok) throw new OpsCoreClientError(`HTTP ${response.status}`)
  return validateAssessment(await response.json())
}

export const loadLocalAiAssessment = (config: OpsCoreConfig, signal?: AbortSignal) => request(config, "GET", "", signal)
export const refreshLocalAiAssessment = (config: OpsCoreConfig, signal?: AbortSignal) => request(config, "POST", "/refresh", signal)

export async function analyzeTargetWithRadar(config: OpsCoreConfig, point: { lat: number; lon: number }, signal?: AbortSignal): Promise<TargetAiAnalysis> {
  if (!validPoint(point)) throw new Error("Invalid review point")
  const token = await currentAccessToken()
  const response = await fetch(`${config.coreBaseUrl}/api/ai/v1/target-analysis`, {
    method: "POST",
    cache: "no-store",
    signal,
    headers: { ...buildCoreRequestHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ latitude: point.lat, longitude: point.lon }),
  })
  if (!response.ok) throw new OpsCoreClientError(`HTTP ${response.status}`)
  const value = validateAssessment(await response.json()) as TargetAiAnalysis
  if (value.context?.context_type !== "SELECTED_TARGET" || value.context.latitude !== point.lat || value.context.longitude !== point.lon || !record(value.radar_evidence)) throw new Error("Aegis returned a different target context")
  return value
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
export function validPoint(point: { lat: number; lon: number } | null | undefined): point is { lat: number; lon: number } {
  return !!point && typeof point.lat === "number" && typeof point.lon === "number" && Number.isFinite(point.lat) && Number.isFinite(point.lon) && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180
}
export function validateAssessment(value: unknown): LocalAiAssessment {
  const text = (field: unknown) => field == null || typeof field === "string"
  const date = (field: unknown) => field == null || (typeof field === "string" && Number.isFinite(Date.parse(field)))
  const duration = (field: unknown) => field == null || (typeof field === "number" && Number.isFinite(field) && field >= 0)
  if (!record(value) || !["available", "degraded", "unavailable"].includes(String(value.status)) || typeof value.generated_at !== "string" || !date(value.generated_at)
    || !date(value.assessment_generated_at) || !text(value.reason) || !text(value.snapshot_id)
    || !duration(value.age_seconds) || !duration(value.latency_ms) || !duration(value.valid_for_seconds)
    || (value.model != null && (!record(value.model) || ![value.model.name, value.model.host, value.model.ollama_model].every(text)))
    || (value.assessment != null && !record(value.assessment))
    || (value.context != null && (!record(value.context) || ![value.context.unit_id, value.context.context_type].every(text)))
    || (value.guard_reasons != null && (!Array.isArray(value.guard_reasons) || !value.guard_reasons.every((reason) => typeof reason === "string")))) throw new Error("Malformed Aegis response")
  return value as LocalAiAssessment
}

export function assessmentSections(value: Pick<LocalAiAssessment, "status" | "assessment"> | null) {
  if (value?.status !== "available" || !value.assessment) return []
  return [
    ["Attention", "recommended_attention"], ["Hazards", "primary_hazards"],
    ["Storm mode", "storm_mode_assessment"], ["Initiation", "initiation_assessment"],
    ["Tornado environment", "tornado_environment_assessment"],
    ["Supporting evidence", "supporting_factors"], ["Limiting factors", "limiting_factors"],
    ["Uncertainty", "uncertainties"], ["Missing inputs", "missing_information"],
  ].flatMap(([label, key]) => {
    const raw = value.assessment?.[key]
    const lines = (Array.isArray(raw) ? raw : [raw]).filter((item): item is string => typeof item === "string" && !!item.trim()).slice(0, 8)
    return lines.length ? [{ label, lines }] : []
  })
}

export function localAiSummary(value: LocalAiAssessment | null): string {
  return assessmentSummary(value)
}

export function assessmentSummary(value: Pick<LocalAiAssessment, "status" | "reason" | "assessment"> | null): string {
  if (!value) return "No Local AI advisory has been loaded."
  if (value.status !== "available") return value.reason ?? "Local AI advisory is not currently available."
  const assessment = value.assessment
  if (!assessment) return "Local AI returned no advisory content."
  for (const key of ["environment_summary", "headline", "summary", "situation", "assessment"]) {
    const candidate = assessment[key]
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim()
  }
  return "Local AI advisory is available for the current Core unit context."
}
