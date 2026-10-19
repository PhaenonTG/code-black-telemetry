import { describe, expect, it, vi } from "vitest";
import { planFabricReconnect } from "./fabricReconnect";

describe("Fabric stream reconnect planning", () => {
  it("rotates a completed bounded stream immediately without marking it closed", () => {
    const nextBackoff = vi.fn(() => 2_000);

    expect(planFabricReconnect(true, true, nextBackoff)).toEqual({
      delayMs: 0,
      markClosed: false,
    });
    expect(nextBackoff).not.toHaveBeenCalled();
  });

  it.each([
    { completedNormally: false, receivedSnapshot: true, label: "failed after a snapshot" },
    { completedNormally: false, receivedSnapshot: false, label: "failed before a snapshot" },
    { completedNormally: true, receivedSnapshot: false, label: "closed before its first snapshot" },
  ])("backs off when the stream $label", ({ completedNormally, receivedSnapshot }) => {
    const nextBackoff = vi.fn(() => 2_000);

    expect(planFabricReconnect(completedNormally, receivedSnapshot, nextBackoff)).toEqual({
      delayMs: 2_000,
      markClosed: true,
    });
    expect(nextBackoff).toHaveBeenCalledOnce();
  });
});
