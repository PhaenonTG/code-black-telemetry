export type AdvisoryReview = {
  status: string; model: string; reason?: string; summary?: string;
  supporting_factors?: string[]; limiting_factors?: string[]; uncertainties?: string[];
  missing_information?: string[]; attention?: string[]; primary_hazards?: string[];
  storm_mode?: string; initiation?: string;
  automatic?: boolean; completed_at?: string;
};
export type SetupDecision = { id: string; decision: string; note: string; actor_role: string; decided_at: string; revision: number };
export type PaidSetupReview = {
  status: string; reviewed_at?: string; model?: string; verdict?: "ready" | "withhold";
  confidence?: "low" | "moderate" | "high"; summary?: string; supporting_factors?: string[];
  uncertainties?: string[]; next_hour_triggers?: string[];
};
export type EvidenceWeightSource = "spc_tornado_outlook" | "hrrr_screening" | "rap" | "nbm" | "gfs" | "gefs" |
  "gefs_extended" | "aigefs" | "href" | "wofs" | "extended_outlook" | "surface_observations" | "environment_profiles" | "mesoscale_discussions" |
  "watches" | "warnings" | "observed_radar";
export type ReviewWeightSource = "aegis" | "local_30b" | "paid_review";
export type SetupWeightPolicy = {
  schema: "codeblack.chase.weight-policy.v2"; policy_id: string; mode: "advisory_only";
  evidence_weights: Record<EvidenceWeightSource, number>;
  review_weights: Record<ReviewWeightSource, number>;
  rules: { renormalize_available_sources: true; official_sources_remain_authoritative: true;
    weights_do_not_modify_raw_values: true; approval_gates_cannot_be_weighted: true };
};
export type SetupWeightBinding = {
  schema: "codeblack.chase.weight-policy-binding.v1"; setup_id: string; revision: number;
  source_fingerprint: string; policy: SetupWeightPolicy; policy_digest: string;
};
export type SetupWeightPolicyEvent = {
  id: string; changed_at: string; actor_role: string; revision: number;
  prior_policy_digest: string; policy_digest: string;
};
export type SetupWorkflow = {
  status: string; reviewers: Record<string, AdvisoryReview>; packet_digest?: string;
  started_at?: string; completed_at?: string; missing_evidence?: string[];
  approval_blockers?: string[]; decision?: SetupDecision | null; decision_history?: SetupDecision[];
  comparison?: { status: string; differences: string[] };
  paid_review?: PaidSetupReview;
  weight_policy?: SetupWeightBinding;
  weight_policy_history?: SetupWeightPolicyEvent[];
  review_synthesis?: ReviewSynthesis;
};
export type WeightedContribution = { source: EvidenceWeightSource; available: boolean; detail: string; configured_weight_bp: number; available_influence_bp: number };
export type ModelMatrixRow = { source: string; status: string; role?: string; run_age_hours?: number; sampled_hours?: number; fields: string[]; experimental: boolean; ensemble_complete?: boolean | null };
export type ObservationMatrixRow = { source: string; status: string; count: number; observed_at?: string; freshness?: string };
export type WeightedSynthesis = { schema: string; policy_digest: string; coverage_bp: number; coverage_percent: number;
  contributions: WeightedContribution[]; missing_weighted_sources: string[]; model_matrix: ModelMatrixRow[];
  observation_matrix: ObservationMatrixRow[]; corridor_support: Array<{ latitude: number; longitude: number; valid_time?: string; screening_index?: number; supporting_sources: string[]; source_count: number; notice: string }>;
  explanation: string };
export type ReviewSynthesis = { schema: string; coverage_bp: number; contributions: Array<{ source: ReviewWeightSource; available: boolean; configured_weight_bp: number; available_influence_bp: number }>; explanation: string };
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
