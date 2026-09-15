import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSoundingPoint, OpsCoreClientError, searchSoundingLocation } from "./client";
import type { OpsCoreConfig } from "./config";

function config(overrides: Partial<OpsCoreConfig> = {}): OpsCoreConfig {
  return {
    mode: "LIVE_CORE",
    coreBaseUrl: "https://ops.codeblackwx.com/api/core",
    coreWsUrl: "wss://ops.codeblackwx.com/api/core",
    unitId: "cbwx-unit-tessa",
    stormIntelPollSeconds: 30,
    ...overrides,
  };
}

// Same shape a real Norman OK response from Core's /api/soundings/v1/point returned live this
// pass -- used here only to exercise transport/error-handling, not the science itself (that's
// covered by services/core-api's own test suite against the canonical engine).
function representativeSoundingBody() {
  return {
    location: { name: "Norman, OK", latitude: 35.2225717, longitude: -97.4394816 },
    model: "HRRR",
    run_time: "2026-09-15 21:00:00+00:00",
    forecast_hour: 1,
    valid_time: "2026-09-15 22:00:00+00:00",
    generated_at: "2026-09-15T22:23:49Z",
    profile: {
      pressure_hpa: [1000, 925, 850],
      height_m: [365, 1017, 1717],
      temp_c: [24.7, 18.8, 11.9],
      dewp_c: [17.8, 13.1, 4.8],
      u_ms: [2.0, 8.1, 12.5],
      v_ms: [1.0, 4.5, 7.0],
      parcel_temp_c: [24.7, 14.9, 6.1],
    },
    derived: {
      sbcape: { label: "SBCAPE", value: 890.0, unit: "J/kg", provenance: "source", note: null },
    },
    hodograph_points: [{ height_m: 365, u_ms: 2.0, v_ms: 1.0 }],
  };
}

describe("fetchSoundingPoint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests the soundings point route with lat/lon and an optional location name", async () => {
    let requestedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        requestedUrl = url;
        return new Response(JSON.stringify(representativeSoundingBody()), { status: 200 });
      }),
    );
    const result = await fetchSoundingPoint(config(), { lat: 35.2225717, lon: -97.4394816 }, { locationName: "Norman, OK" });
    expect(requestedUrl).toContain("/api/soundings/v1/point?");
    expect(requestedUrl).toContain("latitude=35.2225717");
    expect(requestedUrl).toContain("longitude=-97.4394816");
    expect(requestedUrl).toContain("location_name=Norman");
    expect(result.model).toBe("HRRR");
    expect(result.profile.pressure_hpa).toEqual([1000, 925, 850]);
    for (let i = 0; i < result.profile.pressure_hpa.length - 1; i++) {
      expect(result.profile.pressure_hpa[i]).toBeGreaterThan(result.profile.pressure_hpa[i + 1]);
    }
  });

  it("passes an explicit model override through to the query string", async () => {
    let requestedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        requestedUrl = url;
        return new Response(JSON.stringify(representativeSoundingBody()), { status: 200 });
      }),
    );
    await fetchSoundingPoint(config(), { lat: 35.22, lon: -97.44 }, { model: "HRRR" });
    expect(requestedUrl).toContain("model=HRRR");
  });

  it("throws OpsCoreClientError (never a raw fetch rejection) on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream unreachable", { status: 502 })));
    await expect(fetchSoundingPoint(config(), { lat: 35.22, lon: -97.44 })).rejects.toBeInstanceOf(OpsCoreClientError);
  });

  it("refuses to call out when Core is not configured, without a network attempt", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(fetchSoundingPoint(config({ coreBaseUrl: "" }), { lat: 35.22, lon: -97.44 })).rejects.toBeInstanceOf(OpsCoreClientError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("searchSoundingLocation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests the search-location route with city and state", async () => {
    let requestedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        requestedUrl = url;
        return new Response(
          JSON.stringify({
            query_city: "Norman",
            query_state: "OK",
            display_name: "Norman, Cleveland County, Oklahoma",
            latitude: 35.2225717,
            longitude: -97.4394816,
            source: "OpenStreetMap Nominatim",
          }),
          { status: 200 },
        );
      }),
    );
    const result = await searchSoundingLocation(config(), "Norman", "OK");
    expect(requestedUrl).toContain("/api/soundings/v1/search-location?");
    expect(requestedUrl).toContain("city=Norman");
    expect(requestedUrl).toContain("state=OK");
    expect(result.latitude).toBeCloseTo(35.2225717);
  });

  it("surfaces an unknown location as OpsCoreClientError, not a silent fallback point", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "not found" }), { status: 404 })));
    await expect(searchSoundingLocation(config(), "Nowhereville", "ZZ")).rejects.toBeInstanceOf(OpsCoreClientError);
  });
});
