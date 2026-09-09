import { describe, expect, it } from "vitest";
import { resolveTdotEndpoint } from "./tdotRelay";

describe("TDOT relay allowlist", () => {
  it("maps supported public SmartWay endpoints", () => {
    expect(resolveTdotEndpoint(new URL("https://ops.example/api/tdot/RoadwayCameras"))?.toString())
      .toBe("https://www.tdot.tn.gov/opendata/api/public/RoadwayCameras");
  });

  it("rejects arbitrary paths", () => {
    expect(resolveTdotEndpoint(new URL("https://ops.example/api/tdot/Admin"))).toBeNull();
    expect(resolveTdotEndpoint(new URL("https://ops.example/api/tdot/RoadwayCameras/delete"))).toBeNull();
  });
});
