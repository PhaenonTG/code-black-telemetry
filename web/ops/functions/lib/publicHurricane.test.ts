import { describe, expect, it } from "vitest";
import { deriveProjection, handlePublicHurricane, toPublicHurricane } from "./publicHurricane";
import { bearingToCenter } from "../../../hurricane/src/watchLocation";

const sample = {
  status: "active", checked_at: "2026-10-09T00:00:00Z", storm: { id: "al092026", name: "Isaias", pressure: "974", latitudeNumeric: 24.9,
    longitudeNumeric: -88.8, forecastTrack: { issuance: "2026-10-09T03:00:00Z" }, publicAdvisory: { url: "https://www.nhc.noaa.gov/" } },
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
  it("publishes a bounded official landfall and review phase without private watch data", () => {
    const result = toPublicHurricane({ ...sample,
      official_landfall: { status: "confirmed", at: "2026-10-10T01:30:00Z", observed_at: "2026-10-10T02:15:00Z", location: "Destin, Florida",
        source: "https://www.nhc.noaa.gov/text/refresh/MIATCUAT4+shtml/" },
      paid_policy: { phase: "landfall_severe", model: "gpt-6.1-sol" },
    });
    expect(result.official.landfall).toEqual({ status: "confirmed", at: "2026-10-10T01:30:00Z", observed_at: "2026-10-10T02:15:00Z", location: "Destin, Florida",
      source: "https://www.nhc.noaa.gov/text/refresh/MIATCUAT4+shtml/", wind_mph: null, pressure_mb: null });
    expect(result.monitoring.paid_phase).toBe("landfall_severe");
    expect(toPublicHurricane({ ...sample, official_landfall: { status: "confirmed", at: "2026-10-10T01:30:00Z", location: "DESTIN FLORIDA", source: "https://www.nhc.noaa.gov/" } }).official.landfall?.location).toBe("Destin, Florida");
    expect(JSON.stringify(result)).not.toContain("Rolling Meadows");
    expect(toPublicHurricane({ ...sample, official_landfall: { status: "confirmed", at: "wrong", location: "12150 Rolling Meadows Ln", source: "https://evil.test/" } }).official.landfall).toBeNull();
  });
  it("withholds a paid review that still treats confirmed landfall as pending", () => {
    const result = toPublicHurricane({ ...sample,
      official_landfall: { status: "confirmed", at: "2026-10-10T01:30:00Z", observed_at: "2026-10-10T02:15:00Z", location: "DESTIN FLORIDA", source: "https://www.nhc.noaa.gov/" },
      ai: { status: "ready", review_model: "gpt-6.1-sol", review_verdict: "revise", reviewed_at: "2026-10-10T02:30:00Z", analyzed_at: "2026-10-10T02:30:00Z",
        summary: "The newest data suggest a future crossing, but landfall is not confirmed yet." },
    });
    expect(result.ai.status).toBe("withheld");
    expect(result.ai.summary).toBeNull();
    const unresolved = toPublicHurricane({ ...sample,
      official_landfall: { status: "confirmed", at: "2026-10-10T01:30:00Z", observed_at: "2026-10-10T02:15:00Z", location: "DESTIN FLORIDA", source: "https://www.nhc.noaa.gov/" },
      ai: { status: "ready", review_model: "gpt-6.1-sol", review_verdict: "revise", reviewed_at: "2026-10-10T02:35:00Z", analyzed_at: "2026-10-10T02:35:00Z",
        summary: "The packet does not resolve coastal-crossing status, although the storm is inland." },
    });
    expect(unresolved.ai.status).toBe("withheld");
  });
  it("computes a sixteen-point bearing from the watch point to the center", () => {
    const watch = { label: "Grand Bay, AL", latitude: 30, longitude: -88 };
    expect(bearingToCenter(watch, { latitude: 28, longitude: -89 }).direction).toBe("SSW");
    expect(bearingToCenter(watch, { latitude: 32, longitude: -88 })).toEqual({ degrees: 0, direction: "N" });
  });
  it("excludes private point and private AI prose, point alerts and reports", () => {
    const publicData = toPublicHurricane(sample);
    const text = JSON.stringify(publicData);
    for (const secret of ["12150", "Rolling Meadows", "30.447577800627", "Private point alert", "Private local report"]) {
      expect(text).not.toContain(secret);
    }
    expect(publicData.projection.status).toBe("unavailable");
    expect(publicData.projection.points).toEqual([]);
    expect(publicData.storm.max_wind_mph).toBe(100);
    expect(publicData.guidance.models.map((model) => model.id)).toEqual(["HFAI", "HFBI", "CTCI", "AEMI", "HCCA"]);
    expect(publicData.ai.status).toBe("withheld");
    expect(publicData.ai.summary).toBeNull();
  });

  it("publishes only safe second-pass reviewed Aegis findings", () => {
    const safe = { ...sample, ai: { status: "ready", analyzed_at: "2026-10-09T04:12:00Z",
      reviewed_at: "2026-10-09T04:13:00Z", review_model: "qwen3-coder:30b", review_verdict: "revise",
      summary: "Storm surge warning remains active along the northern Gulf coast.",
      next_hour_outlook: "Expect the next reconnaissance fix and coastal observations to refine the center position.",
      supporting_factors: ["Official warning remains active", "Private detail at 12150 Rolling Meadows Ln"],
      uncertainties: ["Local impacts may vary"], recommended_attention: ["Monitor National Weather Service updates"] } };
    const result = toPublicHurricane(safe);
    expect(result.ai).toEqual({ status: "ready", analyzed_at: "2026-10-09T04:12:00Z",
      reviewed_at: "2026-10-09T04:13:00Z", review_model: "qwen3-coder:30b",
      summary: "Storm surge warning remains active along the northern Gulf coast.",
      next_hour_outlook: "Expect the next reconnaissance fix and coastal observations to refine the center position.",
      landfall: null,
      supporting_factors: ["Official warning remains active"], uncertainties: ["Local impacts may vary"],
      recommended_attention: ["Monitor National Weather Service updates"] });
  });

  it("keeps an approved clarification that multiple centers are not observed", () => {
    const result = toPublicHurricane({ ...sample, ai: { status: "ready", analyzed_at: "2026-10-09T04:12:00Z",
      reviewed_at: "2026-10-09T04:13:00Z", review_model: "qwen3-coder:30b", review_verdict: "approve",
      summary: "Multiple storm centers are not observed; model guidance represents one cyclone.",
      next_hour_outlook: "Monitor newly arriving observations and official guidance for material change.",
      supporting_factors: [], uncertainties: [], recommended_attention: [] } });
    expect(result.ai.status).toBe("ready");
    expect(result.ai.summary).toContain("not observed");
  });

  it("publishes a paid reviewer choice only when it matches a source-derived crossing", () => {
    const crossing = { id: "HFAI", center_time: "2026-10-10T01:00:00Z", window_start: "2026-10-09T22:00:00Z",
      window_end: "2026-10-10T04:00:00Z", latitude: 30.25, longitude: -87.7,
      region: "Alabama coast", nearest_city: "Gulf Shores, AL" };
    const ai = { status: "ready", analyzed_at: "2026-10-09T04:12:00Z", reviewed_at: "2026-10-09T04:13:00Z",
      review_model: "gpt-6.1-sol", review_verdict: "revise", input_fingerprint: "same",
      summary: "The official forecast continues to favor the northern Gulf coast.", landfall: crossing };
    const result = toPublicHurricane({ ...sample, input_fingerprint: "same", landfall_candidates: [crossing], ai });
    expect(result.ai.landfall).toMatchObject({ source: "HFAI", nearest_city: "Gulf Shores, AL" });
    expect(toPublicHurricane({ ...sample, input_fingerprint: "changed", landfall_candidates: [crossing], ai }).ai.landfall).toBeNull();
    expect(toPublicHurricane({ ...sample, input_fingerprint: "same", landfall_candidates: [crossing],
      ai: { ...ai, landfall: { ...crossing, latitude: 31.5 } } }).ai.landfall).toBeNull();
  });

  it("publishes bounded paid forecast reasoning and next-run requests without private detail", () => {
    const crossing = { id: "HFAI", center_time: "2026-10-10T01:00:00Z", window_start: "2026-10-09T22:00:00Z",
      window_end: "2026-10-10T04:00:00Z", latitude: 30.25, longitude: -87.7,
      region: "Alabama coast", nearest_city: "Gulf Shores, AL" };
    const alternate = { ...crossing, id: "HFBI", nearest_city: "Mobile, AL" };
    const ai = { status: "ready", analyzed_at: "2026-10-09T04:12:00Z", reviewed_at: "2026-10-09T04:13:00Z",
      review_model: "gpt-6.1-sol", review_verdict: "revise", input_fingerprint: "same",
      summary: "The official forecast continues to favor the northern Gulf coast.", landfall: crossing,
      decision_record: { track_assessment: "New guidance favors the eastern corridor.", intensity_assessment: "Strengthening remains plausible.",
        confidence: "moderate", confidence_reason: "Track spread remains material.", alternate_landfall: alternate,
        hazards: { wind: "Damaging wind remains possible.", coastal_water: "Coastal flooding remains possible.",
          flooding: "Heavy rainfall warrants attention.", tornado: "Outer bands could support tornadoes." },
        changes: ["New aircraft evidence supports strengthening.", "Private address 12150 Rolling Meadows Ln"],
        next_hour_triggers: ["A new center fix could shift the forecast."], missing_sources: ["Coastal observations are stale."],
        data_requests: [{ source: "Coastal tide gauges", question: "Are water levels rising?", why: "This would refine coastal hazard guidance.", priority: "high" },
          { source: "Private 12150 Rolling Meadows Ln", question: "What is happening there?", why: "Private detail", priority: "low" }] } };
    const result = toPublicHurricane({ ...sample, input_fingerprint: "same", landfall_candidates: [crossing, alternate], ai });
    expect(result.ai.decision_record?.alternate_landfall?.nearest_city).toBe("Mobile, AL");
    expect(result.ai.decision_record?.data_requests).toHaveLength(1);
    expect(result.ai.decision_record?.changes).toEqual(["New aircraft evidence supports strengthening."]);
    expect(JSON.stringify(result)).not.toContain("Rolling Meadows");
    expect(toPublicHurricane({ ...sample, input_fingerprint: "changed", landfall_candidates: [crossing, alternate], ai }).ai.decision_record).toBeUndefined();
  });

  it("withholds old unreviewed drafts even when marked ready", () => {
    const result = toPublicHurricane({ ...sample, ai: { status: "ready",
      summary: "A plausible but unreviewed public briefing." } });
    expect(result.ai.status).toBe("withheld");
    expect(result.ai.summary).toBeNull();
  });

  it("exposes bounded change signals without private report or watch-point detail", () => {
    const result = toPublicHurricane({ ...sample, changes_since_previous: {
      previous_checked_at: "2026-10-09T00:00:00Z", advisory_changed: true,
      new_alerts: ["Tornado Warning", "12150 Rolling Meadows Ln"],
      new_reports: ["private report text"], model_cycle_changes: ["HAFS-A"] } });
    expect(result.changes.new_alerts).toEqual(["Tornado Warning"]);
    expect(result.changes.new_report_count).toBe(1);
    expect(result.changes.model_cycle_changes).toEqual(["HAFS-A"]);
    expect(JSON.stringify(result)).not.toContain("Rolling Meadows");
  });

  it("publishes only sourced aircraft and allowed maritime observations", () => {
    const result = toPublicHurricane({ ...sample, recon: { status: "ready", observed_at: "2026-10-09T10:58:30Z",
      latitude: 26.76, longitude: -87.76, pressure_mb: 959, eye_characteristic: "OPEN SE", eye_diameter_nm: 20,
      max_flight_wind_kt: 102, private_note: "12150 Rolling Meadows Ln" },
      aircraft_fixes: [{ observed_at: "2026-10-09T10:58:30Z", latitude: 26.76, longitude: -87.76,
        pressure_mb: 959, private_note: "12150 Rolling Meadows Ln" }],
      maritime_observations: [{ station: "42012", status: "ready", observed_at: "2026-10-09T11:40:00Z",
        wind_m_s: 16, gust_m_s: 21, pressure_hpa: 1010.2, private_note: "12150 Rolling Meadows Ln" },
        { station: "PRIVATE", status: "ready", observed_at: "2026-10-09T11:40:00Z", pressure_hpa: 1000 }] });
    expect(result.observations.recon.pressure_mb).toBe(959);
    expect(result.observations.recon.max_flight_wind_kt).toBe(102);
    expect(result.observations.aircraft_fixes).toHaveLength(1);
    expect(result.observations.maritime).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("Rolling Meadows");
  });

  it("withholds an uninformative Aegis fallback instead of displaying it as analysis", () => {
    const result = toPublicHurricane({ ...sample, ai: { status: "ready", summary: "Environment status is unsupported with no available fields." } });
    expect(result.ai.status).toBe("withheld");
    expect(result.ai.summary).toBeNull();
  });

  it("keeps consensus aids out of the blend", () => {
    const result = deriveProjection(sample.model_guidance.models, sample.model_guidance.latest_cycle);
    expect(result.member_ids).toEqual(["HFAI", "HFBI", "CTCI"]);
    expect(result.points[0].latitude).toBe(26);
  });

  it("only publishes a persisted projection from this exact completed source check", () => {
    const blend = deriveProjection(sample.model_guidance.models, sample.model_guidance.latest_cycle);
    const current = toPublicHurricane({ ...sample, projection: { ...blend, checked_at: sample.checked_at } });
    const stale = toPublicHurricane({ ...sample, projection: { ...blend, checked_at: "2026-10-08T23:55:00Z" } });
    expect(current.projection.status).toBe("ready");
    expect(current.projection.points[0].members).toBe(3);
    expect(current.projection.cycle_lag_hours).toBe(3);
    expect(current.official.issued_at).toBe("2026-10-09T03:00:00Z");
    expect(stale.projection.status).toBe("unavailable");
  });

  it("never returns raw upstream data through the public route", async () => {
    const env = { CORE_GATEWAY_WORKER: { fetch: async () => new Response(JSON.stringify(sample), { status: 200, headers: { "Content-Type": "application/json" } }) } };
    const response = await handlePublicHurricane(new Request("https://ops.codeblackwx.com/api/public/hurricane", { headers: { Origin: "https://hurricane.codeblackwx.com" } }), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://hurricane.codeblackwx.com");
    expect(await response.text()).not.toContain("Rolling Meadows");
  });

  it("allows the Tropics origin to read the public feed", async () => {
    const env = { CORE_GATEWAY_WORKER: { fetch: async () => new Response(JSON.stringify(sample), { status: 200, headers: { "Content-Type": "application/json" } }) } };
    const response = await handlePublicHurricane(new Request("https://ops.codeblackwx.com/api/public/hurricane", { headers: { Origin: "https://tropics.codeblackwx.com" } }), env);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://tropics.codeblackwx.com");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=5, s-maxage=5");
  });
});
