import type { AegisObservationPlan } from "../aegisObservation"

export function radarEvidenceStatus(radar: AegisObservationPlan["radar"] | null | undefined, sourceFailed = false, now = Date.now()): "ok" | "warn" | "off" {
  if (!radar?.available) return "off"
  const age = radar.updated_at ? now - Date.parse(radar.updated_at) : Infinity
  if (sourceFailed || !Number.isFinite(age) || age < -60_000 || age >= 18 * 60_000) return "warn"
  return Object.values(radar.products ?? {}).some((product) => product.available && product.trustworthy && /^(live|fresh)$/i.test(product.freshness_state ?? "")) ? "ok" : "warn"
}
