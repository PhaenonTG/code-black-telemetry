import { describe, expect, it } from "vitest";
import { resolveModotUrl } from "./modotRelay";

describe("MoDOT relay allowlist", () => {
  it("maps the client route to the current official service", () => {
    const result = resolveModotUrl(new URL("https://ops.example/api/modot/NWSDATA/MapServer/0/query?f=geojson&outFields=*&geometry=-95,36,-89,41&evil=x"));
    expect(result?.origin).toBe("https://mapping.modot.org");
    expect(result?.pathname).toBe("/arcgis/rest/services/TravelerInformation/NWSDATA/MapServer/0/query");
    expect(result?.searchParams.get("geometry")).toBe("-95,36,-89,41");
    expect(result?.searchParams.has("evil")).toBe(false);
  });

  it("rejects arbitrary services and paths", () => {
    expect(resolveModotUrl(new URL("https://ops.example/api/modot/Admin/MapServer/0/query"))).toBeNull();
    expect(resolveModotUrl(new URL("https://ops.example/api/modot/NWSDATA/MapServer/0/deleteFeatures"))).toBeNull();
  });
});
