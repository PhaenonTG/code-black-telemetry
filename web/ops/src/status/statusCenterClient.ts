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
}

export interface StatusCenterDocument {
  generated_at?: string
  summary?: { overall?: string; attention_count?: number; tiles?: StatusTile[] }
  attention?: StatusAttention[]
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
  return response.json() as Promise<T>
}

export function fetchStatusCenter(config: OpsCoreConfig): Promise<StatusCenterDocument> {
  return statusRequest<StatusCenterDocument>(config, STATUS_PATH)
}

export function fetchRadarControlSettings(config: OpsCoreConfig): Promise<RadarControlSettings> {
  return statusRequest<RadarControlSettings>(config, RADAR_SETTINGS_PATH)
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
