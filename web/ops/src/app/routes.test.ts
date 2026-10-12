import { describe, expect, it } from "vitest";
import { MORE_PAGE_LINKS, MORE_ROUTE, ROUTES } from "./routes";

describe("OPS workstation routes", () => {
  it("exposes the approved major navigation families with only implemented sections live", () => {
    expect(ROUTES.map((route) => route.label)).toEqual([
      "PRODUCER",
      "CHASE",
      "ANALYSIS",
      "OPERATIONS MAP",
      "WEATHER ANALYSIS",
      "RADAR LAB",
      "MODELS",
      "SOUNDINGS",
      "CONSENSUS",
      "CHASE TARGETS",
      "AEGIS OBSERVATION",
      "TEAM & DEVICES",
      "FIELD INTELLIGENCE",
      "LIVE STREAM",
      "SYSTEM",
      "DIAGNOSTICS",
      "SETTINGS",
    ]);
    expect(ROUTES.filter((route) => route.state === "DEVELOPMENT").map((route) => route.label)).toEqual([
      "MODELS",
      "SOUNDINGS",
      "CONSENSUS",
    ]);
  });

  it("keeps the phone nav bounded to the three approved workspaces and More", () => {
    expect([...ROUTES.filter((route) => route.inPhoneNav), MORE_ROUTE].map((route) => route.label)).toEqual([
      "PRODUCER",
      "CHASE",
      "ANALYSIS",
      "MORE",
    ]);
    expect(MORE_PAGE_LINKS.map((route) => route.label)).toEqual(["OPERATIONS MAP", "WEATHER ANALYSIS", "RADAR LAB", "CHASE TARGETS", "AEGIS OBSERVATION", "TEAM & DEVICES", "FIELD INTELLIGENCE", "LIVE STREAM", "SYSTEM", "DIAGNOSTICS", "SETTINGS"]);
  });
});
