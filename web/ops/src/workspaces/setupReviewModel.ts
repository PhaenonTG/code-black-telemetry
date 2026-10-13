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

export function approvalDisabledReason(workflow: SetupWorkflow | undefined, options: {
  current: boolean; role?: string; note: string; acknowledged: boolean; fingerprint?: string;
}): string | null {
  if (!options.current) return "Return to the current revision before posting.";
  if (!["OWNER", "ADMIN"].includes(options.role ?? "")) return "OWNER or ADMIN access is required to post a reviewed briefing.";
  if (!options.fingerprint) return "This revision is missing its evidence fingerprint. Refresh before continuing.";
  if (!workflow || workflow.status === "not_requested") return "Step 1 is required: run both advisory reviews.";
  if (workflow.status === "pending") return "The advisory reviews are still running.";
  if (workflow.status !== "ready") return "The advisory reviews did not complete. Retry them before posting.";
  if (!Array.isArray(workflow.approval_blockers)) return "Approval requirements are unavailable. Refresh before continuing.";
  if (workflow.approval_blockers.length) return workflow.approval_blockers[0];
  if (!options.note.trim()) return "Add a review note before posting.";
  if (!options.acknowledged) return "Confirm that you read the evidence and review limitations.";
  return null;
}
