import { describe, expect, it } from "vitest";
import { handlePublicTropicalSystem, toPublicTropicalSystem } from "./publicTropicalSystem";

const sample = { status: "active", freshness: "current", storm_id: "ep182026", name: "Rachel", classification: "TS",
  basin: "eastern_pacific", checked_at: "2026-10-10T08:00:00Z", nhc_updated_at: "2026-10-10T07:00:00Z",
  wind_kt: "45", pressure_mb: "1002", current_center: { latitude: 17, longitude: -110 },
  track: [{ latitude: 17, longitude: -110, valid_time: "2026-10-10T07:00:00Z", hour: 0 }],
  reported_centers: [{ latitude: 16, longitude: -109, at: "2026-10-10T01:00:00Z" }],
  guidance: { status: "ready", latest_cycle: "2026-10-10T06:00:00Z", models: [{ id: "HFAI", name: "HAFS-A", cycle: "2026-10-10T06:00:00Z", points: [{ latitude: 18, longitude: -111, hour: 12 }] }] },
  projection: { status: "ready", method: "Independent model median", points: [{ latitude: 19, longitude: -112, hour: 24 }] },
  watch_point: { label: "private address" }, ai: { summary: "private draft" },
  sources: { advisory: "https://www.nhc.noaa.gov/text/MIATCPEP3.shtml", track: "https://www.nhc.noaa.gov/storm_graphics/api/test.kmz", discussion: "https://evil.test/" } };

describe("public storm detail boundary", () => {
  it("publishes NHC/model positions but not private watch or AI prose", () => {
    const result = toPublicTropicalSystem(sample);
    expect(result.status).toBe("active");
    if (result.status !== "active") throw new Error("unexpected status");
    expect(result.track).toHaveLength(1);
    expect(result.guidance.models).toHaveLength(1);
    expect(result.sources.discussion).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/private address|private draft|watch_point/);
  });
  it("rejects path traversal and writes before contacting Core", async () => {
    const invalid = await handlePublicTropicalSystem(new Request("https://ops.codeblackwx.com/api/public/tropical-systems/%2e%2e%2fsecret"), {});
    expect(invalid.status).toBe(404);
    const write = await handlePublicTropicalSystem(new Request("https://ops.codeblackwx.com/api/public/tropical-systems/ep182026", { method: "POST" }), {});
    expect(write.status).toBe(405);
  });
  it("publishes only a review for the current source fingerprint", () => {
    const review = { status: "ready", storm_id: "ep182026", source_fingerprint: "current", reviewed_at: "2026-10-10T08:01:00Z",
      model: "qwen3-coder:30b", confidence: "moderate", summary: "Current evidence supports a compact NHC-scoped assessment.",
      track_assessment: "Aids remain near the official forecast.", intensity_assessment: "Recent measurements indicate strengthening.",
      changes: ["The official center shifted."], uncertainties: ["Aids diverge later."], next_check: ["Review the next advisory."],
      evidence: [{ source: "nhc_track", finding: "The official track remains coherent." }] };
    const current = toPublicTropicalSystem({ ...sample, source_fingerprint: "current", analysis: review });
    expect(current.analysis.status).toBe("ready");
    const changed = toPublicTropicalSystem({ ...sample, source_fingerprint: "new", analysis: review });
    expect(changed.analysis).toEqual({ status: "pending" });
    const stale = toPublicTropicalSystem({ ...sample, source_fingerprint: "current", freshness: "stale", analysis: review });
    expect(stale.analysis).toEqual({ status: "stale" });
    const otherStorm = toPublicTropicalSystem({ ...sample, source_fingerprint: "current", analysis: { ...review, storm_id: "al092026" } });
    expect(otherStorm.analysis).toEqual({ status: "pending" });
    const archived = toPublicTropicalSystem({ ...sample, source_fingerprint: "new", analysis: { status: "pending" },
      prior_reviews: [{ ...review, source_fingerprint: "old", summary: "Prior storm-specific interpretation." },
        { ...review, storm_id: "al092026", summary: "private other storm" },
        { ...review, status: "withheld", source_fingerprint: "older" }] });
    expect(archived.analysis).toEqual({ status: "pending" });
    expect(archived.prior_reviews).toHaveLength(1);
    expect(archived.prior_reviews[0].summary).toBe("Prior storm-specific interpretation.");
    expect(JSON.stringify(archived)).not.toContain("private other storm");
  });
});
