import { describe, expect, it } from "vitest";
import { LatestRequestGate } from "./requestGate";

describe("LatestRequestGate", () => {
  it("keeps the newest rapid map-click request authoritative", () => {
    const gate = new LatestRequestGate();
    const first = gate.next();
    const second = gate.next();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });
});
