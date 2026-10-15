import { describe, expect, it, vi } from "vitest";
import { handleTdotRequest, resolveTdotEndpoint } from "./tdotRelay";

describe("TDOT relay allowlist", () => {
  it("maps supported public SmartWay endpoints", () => {
    expect(resolveTdotEndpoint(new URL("https://ops.example/api/tdot/RoadwayCameras"))?.toString())
      .toBe("https://www.tdot.tn.gov/opendata/api/public/RoadwayCameras");
  });

  it("rejects arbitrary paths", () => {
    expect(resolveTdotEndpoint(new URL("https://ops.example/api/tdot/Admin"))).toBeNull();
    expect(resolveTdotEndpoint(new URL("https://ops.example/api/tdot/RoadwayCameras/delete"))).toBeNull();
  });

  it("returns an empty feed when SmartWay reports no content", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const response = await handleTdotRequest(new Request("https://ops.example/api/tdot/RoadwayWeather"), fetcher);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });
});
