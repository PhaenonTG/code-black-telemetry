import type { EvidenceWeightSource, ReviewWeightSource, SetupWeightPolicy } from "./setupReviewModel";

export const EVIDENCE_WEIGHT_SOURCES: readonly EvidenceWeightSource[] = [
  "spc_tornado_outlook", "hrrr_screening", "rap", "nbm", "gefs", "aigefs",
  "href", "wofs",
  "surface_observations", "environment_profiles", "mesoscale_discussions",
  "watches", "warnings", "observed_radar",
];
export const REVIEW_WEIGHT_SOURCES: readonly ReviewWeightSource[] = ["aegis", "local_30b", "paid_review"];
export const WEIGHT_LABELS: Record<EvidenceWeightSource | ReviewWeightSource, string> = {
  spc_tornado_outlook: "SPC tornado outlook", hrrr_screening: "HRRR screening", rap: "RAP",
  nbm: "NBM", gefs: "GEFS", aigefs: "AIGFS", href: "HREF probabilities", wofs: "WoFS numeric guidance", surface_observations: "Surface observations",
  environment_profiles: "Environmental profiles", mesoscale_discussions: "Mesoscale discussions",
  watches: "Watches", warnings: "Warnings", observed_radar: "Observed radar",
  aegis: "Aegis", local_30b: "Local 30B", paid_review: "Paid review",
};

export function weightTotal(weights: Record<string, number>): number {
  return Object.values(weights).reduce((sum, value) => sum + value, 0);
}

export function setWeight<T extends string>(weights: Record<T, number>, key: T, percent: number): Record<T, number> {
  const basisPoints = Math.round(Math.min(100, Math.max(0, percent)) * 10);
  return { ...weights, [key]: basisPoints };
}

export function validPolicyTotals(policy: SetupWeightPolicy): boolean {
  return weightTotal(policy.evidence_weights) === 1000 && weightTotal(policy.review_weights) === 1000;
}

export function samePolicy(left: SetupWeightPolicy, right: SetupWeightPolicy): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
