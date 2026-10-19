import { describe, expect, it } from "vitest";
import { resolveOdotUrl } from "./odotRelay";

describe("ODOT relay allowlist", () => {
  it("maps only supported feeds and injects the server token", () => {
    const result = resolveOdotUrl(new URL("https://ops.example/api/odot/workzones"), "token");
    expect(result?.origin).toBe("https://oktraffic.org");
    expect(result?.pathname).toBe("/api/Geojsons/workzones");
    expect(result?.searchParams.get("access_token")).toBe("token");
  });
  it("rejects arbitrary paths", () => {
    expect(resolveOdotUrl(new URL("https://ops.example/api/odot/users"), "token")).toBeNull();
  });
});
