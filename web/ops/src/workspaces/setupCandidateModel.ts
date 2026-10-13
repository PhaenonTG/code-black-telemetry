import type { SetupCandidatePoint } from "./SetupTargetMap"

export type RankedCandidate = SetupCandidatePoint & { latitude: number; longitude: number; score_index: number; rank: number; key: string; classification?: string; run_time?: string }

export function rankedCandidates(points: Array<SetupCandidatePoint & { classification?: string; run_time?: string }>): RankedCandidate[] {
  return points.filter((point): point is SetupCandidatePoint & { latitude: number; longitude: number; score_index: number; classification?: string; run_time?: string } =>
    typeof point.latitude === "number" && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90 &&
    typeof point.longitude === "number" && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180 &&
    typeof point.score_index === "number" && Number.isFinite(point.score_index))
    .toSorted((a, b) => b.score_index - a.score_index || (a.valid_time ?? "").localeCompare(b.valid_time ?? ""))
    .map((point, index) => ({ ...point, rank: index + 1, key: `${point.latitude.toFixed(5)},${point.longitude.toFixed(5)},${point.valid_time ?? ""},${point.run_time ?? ""}` }))
}

export type SetupChronologyEntry = { key: string; label: string; at: string }

export function setupChronology(detail: {
  first_seen_at?: string; generated_at?: string; official: { issued_at?: string }; model: { target_points?: Array<{ run_time?: string }> }
}): SetupChronologyEntry[] {
  const newestRun = detail.model.target_points?.map((point) => point.run_time).filter((value): value is string => Boolean(value && Number.isFinite(Date.parse(value)))).toSorted().at(-1)
  return [
    { key: "official", label: "SPC outlook issued", at: detail.official.issued_at },
    { key: "first", label: "Draft first detected", at: detail.first_seen_at },
    { key: "model", label: "Latest retained HRRR run", at: newestRun },
    { key: "draft", label: "Draft evidence generated", at: detail.generated_at },
  ].filter((entry): entry is SetupChronologyEntry => Boolean(entry.at && Number.isFinite(Date.parse(entry.at))))
    .toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at))
}
