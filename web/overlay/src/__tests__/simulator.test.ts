import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StormIntelSimulator } from "../stormIntel/simulator";

describe("StormIntelSimulator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("always marks snapshots as simulation, never live", () => {
    const sim = new StormIntelSimulator();
    expect(sim.getSnapshot().snapshot.simulation).toBe(true);
    expect(sim.getSnapshot().snapshot.providerName).toBe("simulation");
    sim.disconnect();
  });

  it("notifies subscribers when the scenario changes", () => {
    const sim = new StormIntelSimulator();
    const listener = vi.fn();
    const unsubscribe = sim.subscribe(listener);

    sim.setScenario("severe_supercell");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(sim.getSnapshot().scenario).toBe("severe_supercell");
    unsubscribe();
    sim.disconnect();
  });

  it("switches context type and reflects it in the next snapshot", () => {
    const sim = new StormIntelSimulator();
    sim.setContextType("SELECTED_TARGET");
    const snapshot = sim.getSnapshot();
    expect(snapshot.contextType).toBe("SELECTED_TARGET");
    expect(snapshot.snapshot.context.contextType).toBe("SELECTED_TARGET");
    expect(snapshot.snapshot.context.location.resolvedFrom).toBe("explicit_target");
    sim.disconnect();
  });

  it("auto-dismisses a takeover after its hold duration", () => {
    const sim = new StormIntelSimulator();
    sim.triggerTakeover("TOR_WARNING");
    expect(sim.getSnapshot().takeover?.kind).toBe("TOR_WARNING");

    vi.advanceTimersByTime(9001);

    expect(sim.getSnapshot().takeover).toBeNull();
    sim.disconnect();
  });

  it("retriggering a takeover resets the hold timer instead of stacking", () => {
    const sim = new StormIntelSimulator();
    sim.triggerTakeover("SVR_WARNING");
    vi.advanceTimersByTime(5000);
    sim.triggerTakeover("TOR_WARNING");
    vi.advanceTimersByTime(5000);

    // Original SVR_WARNING timer (7s) would have fired by now if not cleared.
    expect(sim.getSnapshot().takeover?.kind).toBe("TOR_WARNING");
    sim.disconnect();
  });

  it("dismissTakeover clears immediately", () => {
    const sim = new StormIntelSimulator();
    sim.triggerTakeover("MESO_DISCUSSION");
    sim.dismissTakeover();
    expect(sim.getSnapshot().takeover).toBeNull();
    sim.disconnect();
  });
});
