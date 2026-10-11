import { buildCoreRequestHeaders, currentAccessToken, OpsCoreClientError } from "./core/client"

export type GpuMode = "BALANCED" | "ANALYSIS" | "PASSIVE_LEARNING" | "MEDIA" | "LIVE_AGENT"

export type GpuOperationsStatus = {
  schema: string
  health: string
  problems: string[]
  governor: { ops_mode: GpuMode; focus_app: string | null; focus_level: string; revision: number; apps: Record<string, { level: string }> }
  gpu: { ok: boolean; used_mb: number | null; total_mb: number | null; percent: number | null; llama_server_process_count: number | null; ollama_loaded_model_count: number | null; orphaned_process_count: number | null }
  learning: { ok: boolean; currently_running: string | null; last_result: string | null; protection_blocked: boolean | null; last_cycle_at?: string | null }
}

async function request(path: string, method: "GET" | "POST", body?: object): Promise<GpuOperationsStatus> {
  const token = await currentAccessToken()
  const response = await fetch(path, { method, headers: { ...buildCoreRequestHeaders(token), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined })
  if (!response.ok) throw new OpsCoreClientError(`HTTP ${response.status}`)
  return response.json() as Promise<GpuOperationsStatus>
}

export const loadGpuOperations = () => request("/api/core/api/gpu/v1/status", "GET")
export const setGpuMode = (mode: GpuMode) => request("/api/core/api/gpu/v1/mode", "POST", { mode })
