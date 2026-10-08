import { describe, expect, it } from "vitest";
import { MORE_PAGE_LINKS, MORE_ROUTE, ROUTES } from "./routes";
import { PHONE_ROUTES } from "../layouts/phoneRoutes";

describe("OPS workstation routes", () => {
  it("exposes the approved major navigation families without marking future sections live", () => {
    expect(ROUTES.map((route) => route.label)).toEqual([
      "OPERATIONS MAP",
      "WEATHER ANALYSIS",
      "HURRICANE WATCH",
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
      "CONSENSUS",
      "TARGETS",
    ]);
  });

  it("keeps the phone nav bounded to five destinations", () => {
    expect(PHONE_ROUTES.map((route) => route.label)).toEqual(["HOME", "RADAR", "OPS", "AEGIS", "MORE"]);
    expect([...ROUTES.filter((route) => route.inPhoneNav), MORE_ROUTE].map((route) => route.label)).toEqual([
      "OPERATIONS MAP", "RADAR LAB", "MORE",
    ]);
    expect(MORE_PAGE_LINKS.map((route) => route.label)).toEqual([
      "WEATHER ANALYSIS", "HURRICANE WATCH", "SOUNDINGS", "CHASE OPERATIONS", "FIELD INTELLIGENCE", "LIVE STREAM", "SYSTEM", "SETTINGS",
    ]);
  });
});
