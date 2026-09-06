import { describe, expect, it } from "vitest";
import { MORE_PAGE_LINKS, MORE_ROUTE, ROUTES } from "./routes";

describe("OPS workstation routes", () => {
  it("exposes the approved major navigation families without marking future sections live", () => {
    expect(ROUTES.map((route) => route.label)).toEqual([
      "LIVE OPS",
      "RADAR",
      "STORM INTEL",
      "MODELS",
      "SOUNDINGS",
      "CONSENSUS",
      "TARGETS",
      "FLEET",
      "STREAM",
      "SYSTEM",
      "SETTINGS",
    ]);
    expect(ROUTES.filter((route) => route.state === "DEVELOPMENT").map((route) => route.label)).toEqual([
      "MODELS",
      "SOUNDINGS",
      "CONSENSUS",
      "TARGETS",
      "STREAM",
    ]);
  });

  it("keeps the phone nav bounded to five destinations", () => {
    expect([...ROUTES.filter((route) => route.inPhoneNav), MORE_ROUTE].map((route) => route.label)).toEqual([
      "LIVE OPS",
      "RADAR",
      "STORM INTEL",
      "FLEET",
      "MORE",
    ]);
    expect(MORE_PAGE_LINKS.some((route) => route.label === "CONSENSUS")).toBe(true);
  });
});
