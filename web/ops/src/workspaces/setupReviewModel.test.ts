import { describe, expect, it } from "vitest";
import { approvalDisabledReason, canApprove, type SetupWorkflow } from "./setupReviewModel";
describe("revision approval availability", () => {
  const ready: SetupWorkflow = { status: "ready", reviewers: {}, approval_blockers: [] };
  it("requires the current revision, decision role, and server gate", () => {
    expect(canApprove(ready, true, "OWNER")).toBe(true);
    expect(canApprove(ready, true, "ADMIN")).toBe(true);
    expect(canApprove(ready, true, "OPERATOR")).toBe(false);
    expect(canApprove(ready, false, "OWNER")).toBe(false);
    expect(canApprove({ ...ready, approval_blockers: ["Sources stale"] }, true, "OWNER")).toBe(false);
    expect(canApprove({ ...ready, approval_blockers: undefined }, true, "OWNER")).toBe(false);
    expect(canApprove({ ...ready, status: "incomplete" }, true, "OWNER")).toBe(false);
  });
  it("explains each remaining step before posting to Reviewed Briefings", () => {
    expect(approvalDisabledReason(undefined, { current: true, role: "OWNER", note: "", acknowledged: false, fingerprint: "abc" })).toMatch(/Step 1/);
    expect(approvalDisabledReason(ready, { current: true, role: "OWNER", note: "", acknowledged: false, fingerprint: "abc" })).toMatch(/review note/);
    expect(approvalDisabledReason(ready, { current: true, role: "OWNER", note: "Reviewed", acknowledged: false, fingerprint: "abc" })).toMatch(/Confirm/);
    expect(approvalDisabledReason(ready, { current: true, role: "OWNER", note: "Reviewed", acknowledged: true, fingerprint: "abc" })).toBeNull();
  });
});
