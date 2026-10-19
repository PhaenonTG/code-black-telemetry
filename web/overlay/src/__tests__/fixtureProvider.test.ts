import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURES } from "../stormIntel/fixtures";
import { FixtureStormIntelProvider, type FixtureSequence } from "../stormIntel/fixtureProvider";

function frame(overrides: Partial<FixtureSequence["frames"][number]["state"]> = {}, holdMs = 1000) {
  return {
    holdMs,
    state: {
      contextType: "AT_UNIT" as const,
      scenario: "low_end" as const,
      snapshot: {
        schema: "codeblack.storm-intel.snapshot" as const,
        schemaVersion: "1.0.0" as const,
        generatedAt: "2026-06-04T21:00:00Z",
        context: {
          contextType: "AT_UNIT" as const,
          location: {
            available: false,
            latitude: null,
            longitude: null,
            resolvedFrom: null,
            unitId: null,
            unitPositionObservedAt: null,
            unitPositionHealthState: null,
            headingDeg: null,
            distanceMiles: null,
            unavailableReason: null,
          },
          requestedAt: "2026-06-04T21:00:00Z",
        },
        providerName: "fixture",
        simulation: false,
        metrics: [],
        score: {
          available: false,
          value: null,
          label: "x",
          algorithmId: "x",
          algorithmVersion: "x",
          inputsUsed: [],
          unavailableReason: null,
        },
        canonicalUnits: {},
        available: false,
        unavailableReason: "frame-marker",
      },
      hodograph: { levels: [], srh01: null, srh03: null, shear06: null, source: null, freshness: "unavailable" as const, simulation: false },
      publicLocation: null,
      takeover: null,
      ...overrides,
    },
  };
}

describe("FixtureStormIntelProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts on the first frame", () => {
    const sequence: FixtureSequence = { name: "t", description: "", loop: false, frames: [frame(), frame({ scenario: "severe_supercell" })] };
    const provider = new FixtureStormIntelProvider(sequence);
    expect(provider.getSnapshot().scenario).toBe("low_end");
    provider.disconnect();
  });

  it("advances to the next frame after holdMs and notifies subscribers", () => {
    const sequence: FixtureSequence = {
      name: "t",
      description: "",
      loop: false,
      frames: [frame({ scenario: "low_end" }, 1000), frame({ scenario: "severe_supercell" }, 1000)],
    };
    const provider = new FixtureStormIntelProvider(sequence);
    const listener = vi.fn();
    provider.subscribe(listener);
    vi.advanceTimersByTime(1000);
    expect(provider.getSnapshot().scenario).toBe("severe_supercell");
    expect(listener).toHaveBeenCalledTimes(1);
    provider.disconnect();
  });

  it("holds on the last frame when loop is false", () => {
    const sequence: FixtureSequence = { name: "t", description: "", loop: false, frames: [frame({}, 500)] };
    const provider = new FixtureStormIntelProvider(sequence);
    vi.advanceTimersByTime(10_000);
    expect(provider.getSnapshot().snapshot.unavailableReason).toBe("frame-marker");
    provider.disconnect();
  });

  it("loops back to the first frame when loop is true", () => {
    const sequence: FixtureSequence = {
      name: "t",
      description: "",
      loop: true,
      frames: [frame({ scenario: "low_end" }, 500), frame({ scenario: "severe_supercell" }, 500)],
    };
    const provider = new FixtureStormIntelProvider(sequence);
    vi.advanceTimersByTime(500);
    expect(provider.getSnapshot().scenario).toBe("severe_supercell");
    vi.advanceTimersByTime(500);
    expect(provider.getSnapshot().scenario).toBe("low_end"); // looped
    provider.disconnect();
  });

  it("supports triggerTakeover/dismissTakeover", () => {
    const sequence: FixtureSequence = { name: "t", description: "", loop: false, frames: [frame()] };
    const provider = new FixtureStormIntelProvider(sequence);
    provider.triggerTakeover("SVR_WARNING");
    expect(provider.getSnapshot().takeover?.kind).toBe("SVR_WARNING");
    provider.dismissTakeover();
    expect(provider.getSnapshot().takeover).toBeNull();
    provider.disconnect();
  });

  it("throws for an empty frame sequence rather than silently doing nothing", () => {
    const sequence: FixtureSequence = { name: "empty", description: "", loop: false, frames: [] };
    expect(() => new FixtureStormIntelProvider(sequence)).toThrow();
  });

  it("makes no network calls -- fully offline QA replay", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const provider = new FixtureStormIntelProvider(FIXTURES.normal);
    vi.advanceTimersByTime(5000);
    expect(fetchSpy).not.toHaveBeenCalled();
    provider.disconnect();
    vi.unstubAllGlobals();
  });

  it("ships all six required recorded sequences", () => {
    expect(Object.keys(FIXTURES).sort()).toEqual(
      ["normal", "provider_failure", "reconnect_sequence", "stale_transition", "tornadic", "warning_takeover"].sort(),
    );
  });

  it("the stale_transition fixture actually transitions freshness from current to stale", () => {
    const provider = new FixtureStormIntelProvider(FIXTURES.stale_transition);
    const first = provider.getSnapshot().snapshot.metrics[0]?.freshness;
    vi.advanceTimersByTime(8000);
    const second = provider.getSnapshot().snapshot.metrics[0]?.freshness;
    expect(first).toBe("current");
    expect(second).toBe("stale");
    provider.disconnect();
  });
});
