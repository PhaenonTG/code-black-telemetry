import type { LocalAiAssessment, TargetAiAnalysis } from "../localAiAdvisory"
import { validPoint } from "../localAiAdvisory"
import type { Point } from "./format"

// Exact coordinates: rounding a cache key can attach a briefing to a different map point.
export const reviewPointKey = (point: Point | null | undefined) => validPoint(point) ? `${point.lat},${point.lon}` : ""
export function reviewMatchesPoint(review: TargetAiAnalysis | null | undefined, point: Point | null | undefined): review is TargetAiAnalysis {
  return !!review && validPoint(point) && review.context?.context_type === "SELECTED_TARGET" && review.context.latitude === point.lat && review.context.longitude === point.lon
}
export function assessmentIsStale(value: LocalAiAssessment | TargetAiAnalysis | null, now: number) {
  if (!value) return true
  const time = value.context?.context_type === "SELECTED_TARGET" ? value.generated_at : "assessment_generated_at" in value ? value.assessment_generated_at : null
  const age = time ? now - Date.parse(time) : Infinity
  const duration = "valid_for_seconds" in value && typeof value.valid_for_seconds === "number" && value.valid_for_seconds > 0 ? Math.min(value.valid_for_seconds, 600) * 1000 : 600_000
  return !Number.isFinite(age) || age < -60_000 || age >= duration
}
export function fleetContextMatches(value: LocalAiAssessment | null, unitId: string | null | undefined) {
  return !!unitId && value?.context?.context_type === "AT_UNIT" && value.context.unit_id === unitId
}
export type ReviewSelection = { point: Point; label: string; setupId?: string; revision?: number; validTime?: string; runTime?: string }
export type PointReview = { value: TargetAiAnalysis | null; error: string; requestedAt: number; selection: ReviewSelection }
export type PointReviews = Record<string, PointReview>
export function rememberReview(current: PointReviews, key: string, review: PointReview): PointReviews {
  // Ephemeral session history, not a training journal or persistent server history.
  return Object.fromEntries(Object.entries({ ...current, [key]: review }).sort((a, b) => b[1].requestedAt - a[1].requestedAt).slice(0, 12))
}
