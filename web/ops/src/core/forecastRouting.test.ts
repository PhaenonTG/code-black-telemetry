import { describe, expect, it } from "vitest";
import { arrivalStatus, routeForecastTargets } from "./forecastRouting";

describe("forecast arrival screening", () => {
  it("respects departure, duration and arrival margin", () => {
    expect(arrivalStatus(3600, "2026-10-08T12:00Z", "2026-10-08T14:00Z", 30).status).toBe("reachable");
    expect(arrivalStatus(3600, "2026-10-08T12:00Z", "2026-10-08T13:00Z", 30).status).toBe("late");
    expect(arrivalStatus(NaN, "2026-10-08T12:00Z", "2026-10-08T14:00Z", 30).status).toBe("unknown");
  });
  it("does not invent travel time when routing is unavailable", async () => {
    const targets = await routeForecastTargets([{ latitude: 36, longitude: -94, valid_time: "2026-10-08T14:00Z" }], { latitude: 35, longitude: -95 }, "", "2026-10-08T12:00Z", 30, new AbortController().signal);
    expect(targets[0].arrival.status).toBe("unknown");
  });
});
