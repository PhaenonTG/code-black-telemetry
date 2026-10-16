import type { SetupDraft, SetupIndex } from "./setupSources"
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value))
const id = (value: unknown) => typeof value === "string" && /^setup-\d{8}-[a-f0-9]{10}$/.test(value)
const optionalText = (value: unknown) => value == null || typeof value === "string"
function sourceUrl(value: unknown) {
  if (value == null || value === "") return true
  if (typeof value !== "string") return false
  try { return ["https:", "http:"].includes(new URL(value).protocol) } catch { return false }
}
function polygonGeometry(value: unknown): boolean {
  if (!record(value) || !Array.isArray(value.coordinates)) return false
  const polygons = value.type === "Polygon" ? [value.coordinates] : value.type === "MultiPolygon" ? value.coordinates : []
  let points = 0
  return polygons.length > 0 && polygons.every((polygon) => Array.isArray(polygon) && polygon.length > 0 &&
    polygon.every((ring) => Array.isArray(ring) && ring.length >= 4 && ring.every((position) => {
      points += 1
      return points <= 20000 && Array.isArray(position) && position.length >= 2 &&
        typeof position[0] === "number" && Number.isFinite(position[0]) && Math.abs(position[0]) <= 180 &&
        typeof position[1] === "number" && Number.isFinite(position[1]) && Math.abs(position[1]) <= 90
    })))
}
export function validateSetupIndex(value: unknown): SetupIndex {
  if (!record(value) || typeof value.status !== "string" || !Array.isArray(value.items) || !value.items.every((item) => record(item) && id(item.setup_id) && typeof item.revision === "number" && date(item.generated_at) && date(item.valid_from) && date(item.valid_until) && typeof item.risk_label === "string" && typeof item.day === "number")) throw new Error("Malformed setup index")
  return value as SetupIndex
}
export function validateSetupDraft(value: unknown, expectedId: string): SetupDraft {
  if (!record(value) || value.setup_id !== expectedId || !id(value.setup_id) || typeof value.summary !== "string" || !date(value.generated_at) || !Array.isArray(value.bounds) || value.bounds.length !== 4 || !value.bounds.every(Number.isFinite) || !record(value.model) || !Array.isArray(value.model.target_points) || !record(value.official) || !record(value.review)) throw new Error("Malformed setup detail")
  if (![value.model.status, value.model.source, value.model.notice, value.official.risk_label].every(optionalText) || !sourceUrl(value.official.source_url)) throw new Error("Malformed setup evidence")
  if (!value.model.target_points.every((point) => record(point) && typeof point.latitude === "number" && Math.abs(point.latitude) <= 90 && typeof point.longitude === "number" && Math.abs(point.longitude) <= 180 && Number.isFinite(point.score_index) && typeof point.classification === "string" && date(point.valid_time))) throw new Error("Malformed setup target point")
  if (value.tornado_tracking_map != null) {
    const map = value.tornado_tracking_map
    if (!record(map) || map.schema !== "codeblack.chase.tornado-tracking-map.v1" || !Array.isArray(map.features) || map.features.length > 12 ||
        !map.features.every((feature) => record(feature) && feature.type === "Feature" && polygonGeometry(feature.geometry) &&
          record(feature.properties) && typeof feature.properties.official_risk_label === "string" &&
          Number.isFinite(feature.properties.official_risk_code))) throw new Error("Malformed tornado tracking map")
  }
  return value as SetupDraft
}
