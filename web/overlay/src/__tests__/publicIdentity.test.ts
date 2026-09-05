import { describe, expect, it } from "vitest";
import { isInternalUnitId, resolvePublicIdentity } from "../stormIntel/publicIdentity";

describe("resolvePublicIdentity", () => {
  it("uses the configured human identity when set", () => {
    expect(resolvePublicIdentity("Spencer")).toBe("Spencer");
  });

  it("falls back to the generic brand identity when nothing is configured", () => {
    expect(resolvePublicIdentity(null)).toBe("CODE BLACK WX");
  });

  it("never returns a raw internal fleet unit id, even if one is mistakenly configured", () => {
    expect(resolvePublicIdentity("cbwx-unit-striker")).toBe("CODE BLACK WX");
    expect(resolvePublicIdentity("cbwx-unit-tessa")).toBe("CODE BLACK WX");
    expect(resolvePublicIdentity("CBWX-UNIT-STRIKER")).toBe("CODE BLACK WX");
  });

  it("respects a custom fallback", () => {
    expect(resolvePublicIdentity(null, "STORM TEAM")).toBe("STORM TEAM");
  });
});

describe("isInternalUnitId", () => {
  it("recognizes both real Fabric unit ids", () => {
    expect(isInternalUnitId("cbwx-unit-striker")).toBe(true);
    expect(isInternalUnitId("cbwx-unit-tessa")).toBe(true);
  });

  it("does not flag an ordinary human name", () => {
    expect(isInternalUnitId("Spencer")).toBe(false);
    expect(isInternalUnitId("Nick")).toBe(false);
  });
});
