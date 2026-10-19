import { describe, expect, it } from "vitest";
import { MORE_ROUTE, ROUTES } from "./routes";
import { PHONE_ROUTES } from "../layouts/phoneRoutes";

describe("OPS workstation routes", () => {
  it("exposes the approved major navigation families without marking future sections live", () => {
    expect(ROUTES.filter(route => route.inSidebar).map(route => route.label)).toEqual(["Ops Map", "Field Map", "Chase Desk", "Producer", "Setup Review", "Weather Analysis", "Soundings", "Hurricane", "Radar Lab", "Aegis Alerts", "Team", "Vehicle Weather", "Status", "Coordination", "Directory", "Settings", "Radar R3", "Automation Lab"]);
    expect(ROUTES.filter(route => route.state === "DEVELOPMENT").map(route => route.label)).toEqual(["Radar R3", "Automation Lab", "Models", "Consensus", "Targets"]);
    expect(ROUTES.filter((route) => route.section === "OPERATE" && route.inSidebar).map((route) => route.label)).toEqual([
      "Ops Map", "Field Map", "Chase Desk", "Producer",
    ]);
  });

  it("keeps the phone nav bounded to five destinations", () => {
    expect(PHONE_ROUTES.map((route) => route.label)).toEqual(["HOME", "CHASE", "RADAR", "STATUS", "MORE"]);
    expect([...ROUTES.filter((route) => route.inPhoneNav), MORE_ROUTE].map((route) => route.label)).toEqual([
      "Ops Map", "Chase Desk", "Radar Lab", "Status", "More",
    ]);
  });
});
