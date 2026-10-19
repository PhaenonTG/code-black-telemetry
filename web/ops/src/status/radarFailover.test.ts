import { describe, expect, it } from "vitest";
import { radarFailoverReason, radarFramesAreOperational } from "../../../../src/services/radarFailover";
import type { RadarFrame } from "../../../../src/services/radar";

function frame(ageSeconds: number, freshness: RadarFrame["freshness"] = "LIVE"): RadarFrame {
  return { frameId: "frame", site: { id: "KTLX", name: "Oklahoma City", state: "OK", lat: 35, lon: -97 }, product: "REF", sourceLevel: "LEVEL II", tilt: 1, availableTilts: [1], elevationAngle: 0.5, time: new Date().toISOString(), ageSeconds, freshness, vcp: 212, nyquistVelocity: null, quality: "OK", processingDurationMs: 1, legend: { units: "dBZ", stops: [] }, tileTemplate: "/tiles" };
}

describe("radar site failover", () => {
  it("accepts current delayed scans and rejects stale or incomplete data", () => {
    expect(radarFramesAreOperational([frame(17 * 60, "DELAYED")])).toBe(true);
    expect(radarFramesAreOperational([frame(19 * 60, "STALE")])).toBe(false);
    expect(radarFramesAreOperational([frame(60, "INCOMPLETE")])).toBe(false);
    expect(radarFramesAreOperational([])).toBe(false);
  });

  it("explains why the primary site was rejected", () => {
    expect(radarFailoverReason([])).toBe("PRIMARY UNAVAILABLE");
    expect(radarFailoverReason([frame(60, "INCOMPLETE")])).toBe("PRIMARY INCOMPLETE");
    expect(radarFailoverReason([frame(1250, "STALE")])).toBe("PRIMARY 21M OLD");
  });
});
