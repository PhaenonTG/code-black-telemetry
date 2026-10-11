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
  context?: { unit_id?: string | null; context_type?: string | null } | null
  assessment?: Record<string, unknown> | null
}

async function request(config: OpsCoreConfig, method: "GET" | "POST", suffix: string): Promise<LocalAiAssessment> {
  const token = await currentAccessToken()
  const response = await fetch(`${config.coreBaseUrl}/api/ai/v1/assessment${suffix}`, {
    method,
    cache: "no-store",
    headers: buildCoreRequestHeaders(token),
  })
  if (!response.ok) throw new OpsCoreClientError(`HTTP ${response.status}`)
  return response.json() as Promise<LocalAiAssessment>
}

export const loadLocalAiAssessment = (config: OpsCoreConfig) => request(config, "GET", "")
export const refreshLocalAiAssessment = (config: OpsCoreConfig) => request(config, "POST", "/refresh")

export function localAiSummary(value: LocalAiAssessment | null): string {
  if (!value) return "No Local AI advisory has been loaded."
  if (value.status !== "available") return value.reason ?? "Local AI advisory is not currently available."
  const assessment = value.assessment
  if (!assessment) return "Local AI returned no advisory content."
  for (const key of ["headline", "summary", "situation", "assessment"]) {
    const candidate = assessment[key]
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim()
  }
  return "Local AI advisory is available for the current Core unit context."
}
