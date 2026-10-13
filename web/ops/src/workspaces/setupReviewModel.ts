export type AdvisoryReview = {
  status: string; model: string; reason?: string; summary?: string;
  supporting_factors?: string[]; limiting_factors?: string[]; uncertainties?: string[];
  missing_information?: string[]; attention?: string[]; primary_hazards?: string[];
  storm_mode?: string; initiation?: string;
};
export type SetupDecision = { id: string; decision: string; note: string; actor_role: string; decided_at: string; revision: number };
export type PaidSetupReview = {
  status: string; reviewed_at?: string; model?: string; verdict?: "ready" | "withhold";
  confidence?: "low" | "moderate" | "high"; summary?: string; supporting_factors?: string[];
  uncertainties?: string[]; next_hour_triggers?: string[];
};
export type SetupWorkflow = {
  status: string; reviewers: Record<string, AdvisoryReview>; packet_digest?: string;
  started_at?: string; completed_at?: string; missing_evidence?: string[];
  approval_blockers?: string[]; decision?: SetupDecision | null; decision_history?: SetupDecision[];
  comparison?: { status: string; differences: string[] };
  paid_review?: PaidSetupReview;
};
export function reviewStatus(status?: string): string {
  return ({ ready: "Ready", pending: "Reviewing", not_requested: "Not requested", unavailable: "Unavailable",
    incomplete: "Review incomplete", interrupted: "Interrupted — retry review" } as Record<string, string>)[status ?? ""] ?? "Unavailable";
}
export function canApprove(workflow: SetupWorkflow | undefined, current: boolean, role?: string): boolean {
  return current && ["OWNER", "ADMIN"].includes(role ?? "") && workflow?.status === "ready" &&
    Array.isArray(workflow.approval_blockers) && workflow.approval_blockers.length === 0;
}
