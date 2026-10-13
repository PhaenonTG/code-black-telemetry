import { describe, expect, it } from "vitest";
import type { SetupWeightPolicy } from "./setupReviewModel";
import { EVIDENCE_WEIGHT_SOURCES, REVIEW_WEIGHT_SOURCES, samePolicy, setWeight, validPolicyTotals, weightTotal } from "./setupWeightModel";

const policy = (): SetupWeightPolicy => ({
  schema: "codeblack.chase.weight-policy.v1", policy_id: "balanced-advisory-v1", mode: "advisory_only",
  evidence_weights: {
    spc_tornado_outlook: 220, hrrr_screening: 150, rap: 100, nbm: 80, gefs: 80, aigefs: 50,
    surface_observations: 100, environment_profiles: 70, mesoscale_discussions: 50,
    watches: 30, warnings: 30, observed_radar: 40,
  },
  review_weights: { aegis: 400, local_30b: 400, paid_review: 200 },
  rules: { renormalize_available_sources: true, official_sources_remain_authoritative: true,
    weights_do_not_modify_raw_values: true, approval_gates_cannot_be_weighted: true },
});

describe("setup weight model", () => {
  it("covers every Core evidence and reviewer source with valid totals", () => {
    const value = policy();
    expect(Object.keys(value.evidence_weights)).toEqual(EVIDENCE_WEIGHT_SOURCES);
    expect(Object.keys(value.review_weights)).toEqual(REVIEW_WEIGHT_SOURCES);
    expect(validPolicyTotals(value)).toBe(true);
  });

  it("converts percentages to bounded integer basis points without mutation", () => {
    const original = policy().review_weights;
    const changed = setWeight(original, "aegis", 41.25);
    expect(changed.aegis).toBe(413);
    expect(original.aegis).toBe(400);
    expect(setWeight(original, "aegis", -2).aegis).toBe(0);
    expect(setWeight(original, "aegis", 200).aegis).toBe(1000);
  });

  it("detects unsaved changes and invalid totals", () => {
    const first = policy();
    const second = { ...first, evidence_weights: { ...first.evidence_weights, hrrr_screening: 140 } };
    expect(weightTotal(second.evidence_weights)).toBe(990);
    expect(validPolicyTotals(second)).toBe(false);
    expect(samePolicy(first, second)).toBe(false);
  });
});
