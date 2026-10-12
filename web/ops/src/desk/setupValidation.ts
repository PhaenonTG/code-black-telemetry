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
export function validateSetupIndex(value: unknown): SetupIndex {
  if (!record(value) || typeof value.status !== "string" || !Array.isArray(value.items) || !value.items.every((item) => record(item) && id(item.setup_id) && typeof item.revision === "number" && date(item.generated_at) && date(item.valid_from) && date(item.valid_until) && typeof item.risk_label === "string" && typeof item.day === "number")) throw new Error("Malformed setup index")
  return value as SetupIndex
}
export function validateSetupDraft(value: unknown, expectedId: string): SetupDraft {
  if (!record(value) || value.setup_id !== expectedId || !id(value.setup_id) || typeof value.summary !== "string" || !date(value.generated_at) || !Array.isArray(value.bounds) || value.bounds.length !== 4 || !value.bounds.every(Number.isFinite) || !record(value.model) || !Array.isArray(value.model.target_points) || !record(value.official) || !record(value.review)) throw new Error("Malformed setup detail")
  if (![value.model.status, value.model.source, value.model.notice, value.official.risk_label].every(optionalText) || !sourceUrl(value.official.source_url)) throw new Error("Malformed setup evidence")
  if (!value.model.target_points.every((point) => record(point) && typeof point.latitude === "number" && Math.abs(point.latitude) <= 90 && typeof point.longitude === "number" && Math.abs(point.longitude) <= 180 && Number.isFinite(point.score_index) && typeof point.classification === "string" && date(point.valid_time))) throw new Error("Malformed setup target point")
  return value as SetupDraft
}
