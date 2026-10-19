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

export const STATUS_GET_TIMEOUT_MS = 12_000
export const STATUS_SAVE_TIMEOUT_MS = 20_000

export interface StatusRequestOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

async function statusRequest<T>(config: OpsCoreConfig, path: string, init?: RequestInit, options: StatusRequestOptions = {}): Promise<T> {
  if (!coreConfigured(config)) throw new OpsCoreClientError("Core gateway is unavailable")
  const timeoutMs = options.timeoutMs ?? (init?.method === "PUT" ? STATUS_SAVE_TIMEOUT_MS : STATUS_GET_TIMEOUT_MS)
  const controller = new AbortController()
  const abort = () => controller.abort(options.signal?.reason)
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true })
  })
  const timer = setTimeout(() => controller.abort(new OpsCoreClientError(`Status Center did not respond within ${timeoutMs / 1000} s`)), timeoutMs)
  options.signal?.addEventListener("abort", abort, { once: true })
  if (options.signal?.aborted) abort()
  try {
    return await Promise.race([aborted, (async () => {
      const token = await Promise.race([aborted, currentAccessToken()])
      const response = await fetch(`${config.coreBaseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        cache: "no-store",
        headers: { ...buildCoreRequestHeaders(token), ...init?.headers },
      })
      if (!response.ok) throw new OpsCoreClientError(`Status Center HTTP ${response.status}`)
      if (response.headers.get("content-type")?.toLowerCase().includes("text/html")) throw new OpsCoreClientError("Status Center gateway returned a web page instead of data. Check Ops API routing.")
      try { return await response.json() as T } catch { throw new OpsCoreClientError("Status Center returned invalid data.") }
    })()])
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener("abort", abort)
  }
}

export function fetchStatusCenter(config: OpsCoreConfig, options?: StatusRequestOptions): Promise<StatusCenterDocument> {
  return statusRequest<StatusCenterDocument>(config, STATUS_PATH, undefined, options)
}

export function fetchRadarControlSettings(config: OpsCoreConfig, options?: StatusRequestOptions): Promise<RadarControlSettings> {
  return statusRequest<RadarControlSettings>(config, RADAR_SETTINGS_PATH, undefined, options)
}

export function saveRadarControlSettings(config: OpsCoreConfig, settings: RadarControlSettings, options?: StatusRequestOptions): Promise<RadarControlSettings> {
  return statusRequest<RadarControlSettings>(config, RADAR_SETTINGS_PATH, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      primary_prewarm_enabled: settings.primary_prewarm_enabled,
      primary_interval_seconds: settings.primary_interval_seconds,
    }),
  }, options)
}

export function radarSettingsEqual(left: RadarControlSettings | null, right: RadarControlSettings | null): boolean {
  if (!left || !right) return left === right
  return left.primary_prewarm_enabled === right.primary_prewarm_enabled
    && left.primary_interval_seconds === right.primary_interval_seconds
    && left.secondary_prewarm_enabled === right.secondary_prewarm_enabled
}

export function mergePolledSettings(savedSettings: RadarControlSettings | null, settings: RadarControlSettings | null, polled: RadarControlSettings) {
  return {
    savedSettings: polled,
    settings: !settings || radarSettingsEqual(settings, savedSettings) ? polled : settings,
  }
}
