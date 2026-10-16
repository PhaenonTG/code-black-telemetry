import { buildCoreRequestHeaders, currentAccessToken, OpsCoreClientError } from "../core/client"
import { coreConfigured, type OpsCoreConfig } from "../core/config"

export interface StatusTile {
  id: string
  label: string
  group: string
  state: string
  detail?: string
}

export interface StatusAttention {
  id: string
  severity?: string
  title: string
  detail?: string
  since?: string
  source?: string
  link?: string | null
  status_only?: boolean
  operator?: { acknowledged_at?: string | null; snoozed_until?: string | null }
}

export interface StatusService {
  id: string
  name: string
  host: string
  state: string
  state_reason?: string | null
  last_success?: string | null
  last_error?: string | null
  telemetry?: { last_success?: string | null; stale?: boolean }
}

export interface ProjectDeployment {
  unit: string
  state: string
  release: string | null
  commit: string | null
  deployed_at: string | null
  observed_at: string | null
  runtime_started_at?: string | null
  last_attempt?: { result: string; reported_at: string; release: string; dirty?: boolean } | null
}

export interface ProjectHistory {
  window_start: string
  bin_seconds: number
  bins: string[]
  observed_since: string | null
  persisted: boolean
}

export interface StatusProject {
  id: string
  name: string
  phase: string
  summary: string
  note: string
  health: string
  monitored_count: number
  expected_count: number
  healthy_count: number
  troubled_count: number
  unknown_count: number
  history?: ProjectHistory
  registration?: "REGISTRY" | "MANIFEST" | "DISCOVERED"
  declared_phase?: string
  phase_source?: string
  deployment_state?: string
  deployments?: ProjectDeployment[]
  services: Array<{ id: string; name: string; state: string; host: string; state_reason?: string | null; deployment?: ProjectDeployment | null; monitoring_kind?: string | null }>
  missing_services: string[]
  links: Array<{ id: string; name: string; url: string; access: string }>
}

export interface StatusCenterDocument {
  generated_at?: string
  summary?: { overall?: string; attention_count?: number; tiles?: StatusTile[] }
  attention?: StatusAttention[]
  projects?: StatusProject[]
  project_coverage?: {
    hosts: Array<{ host: string; state: string; observed_at?: string | null }>
    findings: Array<{ kind: string; host?: string; project?: string; detail?: string }>
    finding_count: number
    registered_projects: number
    discovered_projects: number
  }
  services?: StatusService[]
  hosts?: Array<{ id: string; name: string; state: string; state_reason?: string | null }>
  radar?: Record<string, unknown>
  streaming?: Record<string, unknown>
  weather?: Record<string, unknown>
  network?: Record<string, unknown>
  storage?: Record<string, unknown>
  compute?: Record<string, unknown>
  ai?: Record<string, unknown>
}

export interface RadarControlSettings {
  primary_prewarm_enabled: boolean
  primary_interval_seconds: 300 | 600 | 900 | 1800
  secondary_prewarm_enabled?: boolean
}

const STATUS_PATH = "/api/ops/status-center/v1/status"
const RADAR_SETTINGS_PATH = "/api/ops/status-center/v1/radar-control-settings"

async function statusRequest<T>(config: OpsCoreConfig, path: string, init?: RequestInit): Promise<T> {
  if (!coreConfigured(config)) throw new OpsCoreClientError("Core gateway is unavailable")
  const token = await currentAccessToken()
  const response = await fetch(`${config.coreBaseUrl}${path}`, {
    ...init,
    cache: "no-store",
    headers: { ...buildCoreRequestHeaders(token), ...init?.headers },
  })
  if (!response.ok) throw new OpsCoreClientError(`Status Center HTTP ${response.status}`)
  if (response.headers.get("content-type")?.toLowerCase().includes("text/html")) throw new OpsCoreClientError("Status Center gateway returned a web page instead of data. Check Ops API routing.")
  try { return await response.json() as T } catch { throw new OpsCoreClientError("Status Center returned invalid data.") }
}

export function fetchStatusCenter(config: OpsCoreConfig, signal?: AbortSignal): Promise<StatusCenterDocument> {
  return statusRequest<StatusCenterDocument>(config, STATUS_PATH, { signal })
}

export function fetchRadarControlSettings(config: OpsCoreConfig, signal?: AbortSignal): Promise<RadarControlSettings> {
  return statusRequest<RadarControlSettings>(config, RADAR_SETTINGS_PATH, { signal })
}

export function saveRadarControlSettings(config: OpsCoreConfig, settings: RadarControlSettings): Promise<RadarControlSettings> {
  return statusRequest<RadarControlSettings>(config, RADAR_SETTINGS_PATH, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      primary_prewarm_enabled: settings.primary_prewarm_enabled,
      primary_interval_seconds: settings.primary_interval_seconds,
    }),
  })
}
