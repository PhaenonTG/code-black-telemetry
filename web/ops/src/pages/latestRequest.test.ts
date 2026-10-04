import { describe, expect, it } from "vitest";
import { LatestRequest } from "./latestRequest";

describe("latest Soundings request", () => {
  it("cancels and invalidates an older location request", () => {
    const requests = new LatestRequest();
    const first = requests.begin();
    const second = requests.begin();
    expect(first.controller.signal.aborted).toBe(true);
    expect(requests.isCurrent(first)).toBe(false);
    expect(requests.isCurrent(second)).toBe(true);
  });

  it("invalidates an in-flight request when the workspace closes", () => {
    const requests = new LatestRequest();
    const request = requests.begin();
    requests.cancel();
    expect(request.controller.signal.aborted).toBe(true);
    expect(requests.isCurrent(request)).toBe(false);
  });
});
