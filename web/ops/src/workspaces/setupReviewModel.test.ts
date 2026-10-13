import { describe, expect, it } from "vitest";
import { canApprove, type SetupWorkflow } from "./setupReviewModel";
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
});
