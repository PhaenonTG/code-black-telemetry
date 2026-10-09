import { describe, expect, it } from "vitest";
import { hurricaneCategory } from "../../../shared/hurricaneCategory";

describe("official wind category", () => {
  it("uses NHC Saffir–Simpson mph boundaries", () => {
    expect([74, 95, 96, 110, 111, 129, 130, 156, 157].map((wind) => hurricaneCategory(wind, "HU")))
      .toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5]);
  });
  it("does not label non-hurricanes or missing winds", () => {
    expect(hurricaneCategory(70, "HU")).toBeNull();
    expect(hurricaneCategory(105, "TS")).toBeNull();
    expect(hurricaneCategory(null, "HU")).toBeNull();
  });
});
