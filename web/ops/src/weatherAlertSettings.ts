import { buildCoreRequestHeaders, currentAccessToken, OpsCoreClientError } from "./core/client"

export type WeatherAlertSettings = {
  schema: string
  enabled: Record<"tornado_warnings" | "nwws_realtime" | "spc_md" | "spc_day1" | "significant_lsr", boolean>
  routing: { use_live_location: boolean; live_radius_miles: number; manual_radius_miles: number; manual_ttl_minutes: number }
  filters: { lsr_min_hail_inches: number; lsr_min_wind_mph: number; outlook_tornado: boolean; outlook_risks: string[] }
  manual_area: { label: string; lat: number; lon: number } | null
  target: { enabled: boolean; label: string; lat: number | null; lon: number | null; match_radius_miles: number }
}

const PATH = "/api/core/api/weather-alert/v1/settings"

async function request(method: "GET" | "PUT", body?: WeatherAlertSettings): Promise<WeatherAlertSettings> {
  const token = await currentAccessToken()
  const response = await fetch(PATH, {
    method,
    headers: { ...buildCoreRequestHeaders(token), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) throw new OpsCoreClientError(`HTTP ${response.status}`)
  return response.json() as Promise<WeatherAlertSettings>
}

export const loadWeatherAlertSettings = () => request("GET")
export const saveWeatherAlertSettings = (settings: WeatherAlertSettings) => request("PUT", settings)
