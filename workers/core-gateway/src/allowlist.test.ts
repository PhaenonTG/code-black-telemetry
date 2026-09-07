import { describe, expect, it } from "vitest";
import { ALLOWLIST, buildCoreUrl, CORE_ORIGIN, resolveRoute, validateQueryParams } from "./allowlist";

describe("resolveRoute", () => {
  it("resolves every documented Core route", () => {
    expect(resolveRoute("/health")).toEqual(ALLOWLIST["/health"]);
    expect(resolveRoute("/api/fabric/v1/health")).toEqual(ALLOWLIST["/api/fabric/v1/health"]);
    expect(resolveRoute("/api/fabric/v1/units")).toEqual(ALLOWLIST["/api/fabric/v1/units"]);
    expect(resolveRoute("/api/storm-intel/v1/health")).toEqual(ALLOWLIST["/api/storm-intel/v1/health"]);
    expect(resolveRoute("/api/storm-intel/v1/point")).toEqual(ALLOWLIST["/api/storm-intel/v1/point"]);
  });

  it("rejects any non-allowlisted path -- no open proxy", () => {
    expect(resolveRoute("/admin")).toBeNull();
    expect(resolveRoute("/ssh")).toBeNull();
    expect(resolveRoute("/../etc/passwd")).toBeNull();
    expect(resolveRoute("/api/core/health")).toBeNull();
    expect(resolveRoute("/health/")).toBeNull();
    expect(resolveRoute("")).toBeNull();
  });
});

describe("validateQueryParams", () => {
  const pointRoute = ALLOWLIST["/api/storm-intel/v1/point"];
  const noParamRoute = ALLOWLIST["/health"];

  it("passes routes with no query params regardless of what is on the URL", () => {
    const url = new URL("https://internal/health?anything=1&admin=true");
    expect(validateQueryParams(noParamRoute, url)).toEqual({ ok: true });
  });

  it("accepts valid latitude/longitude", () => {
    const url = new URL("https://internal/api/storm-intel/v1/point?latitude=36.5&longitude=-93.7");
    expect(validateQueryParams(pointRoute, url)).toEqual({ ok: true });
  });

  it("accepts boundary values", () => {
    const url = new URL("https://internal/api/storm-intel/v1/point?latitude=90&longitude=-180");
    expect(validateQueryParams(pointRoute, url)).toEqual({ ok: true });
  });

  it("rejects missing latitude", () => {
    const url = new URL("https://internal/api/storm-intel/v1/point?longitude=-93.7");
    expect(validateQueryParams(pointRoute, url)).toEqual({ ok: false, reason: "INVALID_LATITUDE" });
  });

  it("rejects missing longitude", () => {
    const url = new URL("https://internal/api/storm-intel/v1/point?latitude=36.5");
    expect(validateQueryParams(pointRoute, url)).toEqual({ ok: false, reason: "INVALID_LONGITUDE" });
  });

  it("rejects non-numeric latitude", () => {
    const url = new URL("https://internal/api/storm-intel/v1/point?latitude=nope&longitude=-93.7");
    expect(validateQueryParams(pointRoute, url)).toEqual({ ok: false, reason: "INVALID_LATITUDE" });
  });

  it("rejects out-of-range latitude", () => {
    const url = new URL("https://internal/api/storm-intel/v1/point?latitude=91&longitude=-93.7");
    expect(validateQueryParams(pointRoute, url)).toEqual({ ok: false, reason: "INVALID_LATITUDE" });
  });

  it("rejects out-of-range longitude", () => {
    const url = new URL("https://internal/api/storm-intel/v1/point?latitude=36.5&longitude=181");
    expect(validateQueryParams(pointRoute, url)).toEqual({ ok: false, reason: "INVALID_LONGITUDE" });
  });
});

describe("buildCoreUrl", () => {
  const pointRoute = ALLOWLIST["/api/storm-intel/v1/point"];

  it("always targets the fixed Core origin, never a caller-supplied host", () => {
    const url = new URL(
      "https://internal/api/storm-intel/v1/point?latitude=36.5&longitude=-93.7&host=evil.example.com",
    );
    const built = buildCoreUrl(pointRoute, url);
    expect(built.startsWith(CORE_ORIGIN)).toBe(true);
    expect(built).not.toContain("evil.example.com");
  });

  it("forwards only the allowlisted query params", () => {
    const url = new URL(
      "https://internal/api/storm-intel/v1/point?latitude=36.5&longitude=-93.7&admin=1&debug=true",
    );
    const built = buildCoreUrl(pointRoute, url);
    expect(built).toContain("latitude=36.5");
    expect(built).toContain("longitude=-93.7");
    expect(built).not.toContain("admin");
    expect(built).not.toContain("debug");
  });

  it("preserves expected query parameters exactly", () => {
    const url = new URL("https://internal/api/storm-intel/v1/point?latitude=-12.34&longitude=56.78");
    const built = buildCoreUrl(pointRoute, url);
    expect(built).toBe(`${CORE_ORIGIN}/api/storm-intel/v1/point?latitude=-12.34&longitude=56.78`);
  });

  it("builds no-param routes without a query string", () => {
    const url = new URL("https://internal/health");
    const built = buildCoreUrl(ALLOWLIST["/health"], url);
    expect(built).toBe(`${CORE_ORIGIN}/health`);
  });
});
