import { describe, expect, it } from "vitest";
import { DEFAULT_DRAFT, simulatePolicy } from "./policyLab";

describe("Aegis dispatch policy dry-run", () => {
  it("never routes without a radar candidate", () => {
    expect(simulatePolicy({ ...DEFAULT_DRAFT, candidateAvailable: false, deliveryEnabled: true }).decision).toBe("NO_CANDIDATE");
  });

  it("withholds stale and below-cutoff evidence", () => {
    expect(simulatePolicy({ ...DEFAULT_DRAFT, scanAgeMinutes: 16, deliveryEnabled: true }).decision).toBe("STALE");
    expect(simulatePolicy({ ...DEFAULT_DRAFT, evidenceScore: 84, deliveryEnabled: true }).decision).toBe("BELOW_CUTOFF");
  });

  it("keeps a qualifying candidate in shadow while delivery is off", () => {
    const result = simulatePolicy(DEFAULT_DRAFT);
    expect(result.decision).toBe("SHADOW");
    expect(result.fabric).toBe(false);
    expect(result.discord).toBe(false);
  });

  it("only shows a hypothetical route when all gates pass", () => {
    const result = simulatePolicy({ ...DEFAULT_DRAFT, deliveryEnabled: true });
    expect(result.decision).toBe("WOULD_ROUTE");
    expect(result.fabric && result.ops && result.discord).toBe(true);
  });
});
