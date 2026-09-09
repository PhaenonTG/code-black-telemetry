import { describe, expect, it } from "vitest";
import { MORE_PAGE_LINKS, MORE_ROUTE, ROUTES } from "./routes";

describe("OPS workstation routes", () => {
  it("exposes the approved major navigation families without marking future sections live", () => {
    expect(ROUTES.map((route) => route.label)).toEqual([
      "OPERATIONS MAP",
      "WEATHER ANALYSIS",
      "RADAR LAB",
      "MODELS",
      "SOUNDINGS",
      "CONSENSUS",
      "TARGETS",
      "CHASE OPERATIONS",
      "FIELD INTELLIGENCE",
      "LIVE STREAM",
      "SYSTEM",
      "SETTINGS",
    ]);
    expect(ROUTES.filter((route) => route.state === "DEVELOPMENT").map((route) => route.label)).toEqual([
      "MODELS",
      "SOUNDINGS",
      "CONSENSUS",
      "TARGETS",
    ]);
  });

  it("keeps the phone nav bounded to five destinations", () => {
    expect([...ROUTES.filter((route) => route.inPhoneNav), MORE_ROUTE].map((route) => route.label)).toEqual([
      "OPERATIONS MAP",
      "WEATHER ANALYSIS",
      "RADAR LAB",
      "CHASE OPERATIONS",
      "MORE",
    ]);
    expect(MORE_PAGE_LINKS.map((route) => route.label)).toEqual(["FIELD INTELLIGENCE", "LIVE STREAM", "SYSTEM", "SETTINGS"]);
  });
});
