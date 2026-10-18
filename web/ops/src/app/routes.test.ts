import { describe, expect, it } from "vitest";
import { MORE_ROUTE, ROUTES } from "./routes";
import { PHONE_ROUTES } from "../layouts/phoneRoutes";

describe("OPS workstation routes", () => {
  it("exposes the approved major navigation families without marking future sections live", () => {
    expect(ROUTES.map((route) => route.label)).toEqual([
      "PRODUCER",
      "CHASE DESK",
      "SETUP REVIEW",
      "OPERATIONS MAP",
      "WEATHER ANALYSIS",
      "HURRICANE WATCH",
      "AEGIS RADAR ALERTS",
      "RADAR LAB",
      "MODELS",
      "SOUNDINGS",
      "RADAR R3 CANDIDATE",
      "CONSENSUS",
      "TARGETS",
      "TEAM & DEVICES",
      "VEHICLE WEATHER",
      "FIELD MAP",
      "PROGRAM STATUS",
      "SYSTEM",
      "SITE DIRECTORY",
      "STATUS CENTER",
      "AUTOMATION LAB",
      "COORDINATION",
      "SETTINGS",
    ]);
    expect(ROUTES.filter((route) => route.state === "DEVELOPMENT").map((route) => route.label)).toEqual([
      "MODELS",
      "RADAR R3 CANDIDATE",
      "CONSENSUS",
      "TARGETS",
    ]);
    expect(ROUTES.filter((route) => route.section === "WORKSPACES" && route.inSidebar).map((route) => route.label)).toEqual([
      "PRODUCER", "CHASE DESK", "SETUP REVIEW",
    ]);
  });

  it("keeps the phone nav bounded to five destinations", () => {
    expect(PHONE_ROUTES.map((route) => route.label)).toEqual(["HOME", "RADAR", "SYSTEM", "AEGIS", "MORE"]);
    expect([...ROUTES.filter((route) => route.inPhoneNav), MORE_ROUTE].map((route) => route.label)).toEqual([
      "OPERATIONS MAP", "RADAR LAB", "MORE",
    ]);
  });
});
