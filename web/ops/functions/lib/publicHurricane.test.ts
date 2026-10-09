import { describe, expect, it } from "vitest";
import { deriveProjection, handlePublicHurricane, toPublicHurricane } from "./publicHurricane";

const sample = {
  status: "active", checked_at: "2026-10-09T00:00:00Z", storm: { id: "al092026", name: "Isaias", pressure: "974", latitudeNumeric: 24.9,
    longitudeNumeric: -88.8, publicAdvisory: { url: "https://www.nhc.noaa.gov/" } },
  watch_point: { label: "12150 Rolling Meadows Ln", latitude: 30.447577800627, longitude: -88.329515563521 },
  assessment: { summary: "Private family watch at 12150 Rolling Meadows Ln", intensity_mph: 100 },
  ai: { status: "ready", summary: "Private family watch at 12150 Rolling Meadows Ln" },
  alerts: [{ description: "Private point alert" }], reports: [{ text: "Private local report" }],
  track: [{ hour: 0, latitude: 24.9, longitude: -88.8 }],
  model_guidance: { status: "ready", latest_cycle: "2026-10-09T00:00:00Z", models: [
    { id: "HFAI", name: "HAFS-A", cycle: "2026-10-09T00:00:00Z", points: [0, 6, 12].map((hour) => ({ hour, valid_time: new Date(Date.parse("2026-10-09T00:00:00Z") + hour * 3600_000).toISOString(), latitude: 25 + hour / 10, longitude: -88 })) },
    { id: "HFBI", name: "HAFS-B", cycle: "2026-10-09T00:00:00Z", points: [0, 6, 12].map((hour) => ({ hour, valid_time: new Date(Date.parse("2026-10-09T00:00:00Z") + hour * 3600_000).toISOString(), latitude: 26 + hour / 10, longitude: -87 })) },
    { id: "CTCI", name: "COAMPS-TC", cycle: "2026-10-09T00:00:00Z", points: [0, 6, 12].map((hour) => ({ hour, valid_time: new Date(Date.parse("2026-10-09T00:00:00Z") + hour * 3600_000).toISOString(), latitude: 27 + hour / 10, longitude: -86 })) },
    { id: "AEMI", name: "GEFS ensemble mean", cycle: "2026-10-09T00:00:00Z", points: [] },
    { id: "HCCA", name: "HCCA consensus", cycle: "2026-10-09T00:00:00Z", points: [] },
  ] },
};

describe("public hurricane boundary", () => {
  it("excludes private point and private AI prose, point alerts and reports", () => {
    const publicData = toPublicHurricane(sample);
    const text = JSON.stringify(publicData);
    for (const secret of ["12150", "Rolling Meadows", "30.447577800627", "Private point alert", "Private local report"]) {
      expect(text).not.toContain(secret);
    }
    expect(publicData.projection.status).toBe("ready");
    expect(publicData.projection.points[0].members).toBe(2);
    expect(publicData.storm.max_wind_mph).toBe(100);
    expect(publicData.guidance.models.map((model) => model.id)).toEqual(["HFAI", "HFBI", "CTCI", "AEMI", "HCCA"]);
    expect(publicData.ai.status).toBe("withheld");
    expect(publicData.ai.summary).toBeNull();
  });

  it("publishes only safe guarded Aegis findings with their own analysis time", () => {
    const safe = { ...sample, ai: { status: "ready", analyzed_at: "2026-10-09T04:12:00Z",
      summary: "Storm surge warning remains active along the northern Gulf coast.",
      supporting_factors: ["Official warning remains active", "Private detail at 12150 Rolling Meadows Ln"],
      uncertainties: ["Local impacts may vary"], recommended_attention: ["Monitor National Weather Service updates"] } };
    const result = toPublicHurricane(safe);
    expect(result.ai).toEqual({ status: "ready", analyzed_at: "2026-10-09T04:12:00Z",
      summary: "Storm surge warning remains active along the northern Gulf coast.",
      supporting_factors: ["Official warning remains active"], uncertainties: ["Local impacts may vary"],
      recommended_attention: ["Monitor National Weather Service updates"] });
  });

  it("keeps consensus aids out of the blend", () => {
    const result = deriveProjection(sample.model_guidance.models, sample.model_guidance.latest_cycle);
    expect(result.member_ids).toEqual(["HFAI", "HFBI"]);
    expect(result.points[0].latitude).toBe(25.5);
  });

  it("never returns raw upstream data through the public route", async () => {
    const env = { CORE_GATEWAY_WORKER: { fetch: async () => new Response(JSON.stringify(sample), { status: 200, headers: { "Content-Type": "application/json" } }) } };
    const response = await handlePublicHurricane(new Request("https://ops.codeblackwx.com/api/public/hurricane", { headers: { Origin: "https://hurricane.codeblackwx.com" } }), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://hurricane.codeblackwx.com");
    expect(await response.text()).not.toContain("Rolling Meadows");
  });
});
