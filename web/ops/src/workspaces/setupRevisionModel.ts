export type SetupRevisionEntry = {
  revision: number; captured_at: string; generated_at: string; capture_kind: "baseline" | "revision";
  day: number; risk_label: string; model_status: string; candidate_count: number; model_runs: string[];
  compared_to_revision: number | null; changes: string[] | null;
}

export type SetupRevisionHistory = {
  entries: SetupRevisionEntry[]; oldest_captured_revision: number | null;
  earlier_evidence_unavailable: boolean; has_more: boolean;
}

const changeLabels: Record<string, string> = {
  official_issue: "SPC issue time updated",
  official_risk: "SPC risk level or day changed",
  official_area: "SPC outlook area changed",
  valid_period: "Outlook valid period changed",
  model_status: "HRRR availability changed",
  model_runs: "Retained HRRR run changed",
  screening_points: "Retained screening points changed",
}

export function revisionChanges(entry: SetupRevisionEntry): string[] {
  if (entry.compared_to_revision === null) return ["No earlier captured revision to compare."]
  const labels = entry.changes?.flatMap((key) => changeLabels[key] ? [changeLabels[key]] : []) ?? []
  return labels.length ? labels : ["No change in the displayed SPC and HRRR evidence."]
}

