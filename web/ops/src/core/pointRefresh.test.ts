import { describe, expect, it } from "vitest";
import { mergeStormHealth, shouldRefreshPoint } from "./pointRefresh";
import type { StormIntelState } from "./types";

describe("GPS follow refresh", () => {
  const initial = { lat: 36.45, lon: -94.12 };
  it("loads the first location immediately", () => expect(shouldRefreshPoint(null, initial, 0)).toBe(true));
  it("does not refetch for GPS jitter", () => expect(shouldRefreshPoint(initial, { lat: 36.4501, lon: -94.1201 }, 70_000)).toBe(false));
  it("throttles movement to once per minute", () => expect(shouldRefreshPoint(initial, { lat: 36.50, lon: -94.12 }, 59_999)).toBe(false));
  it("refreshes after a kilometer and a minute", () => expect(shouldRefreshPoint(initial, { lat: 36.50, lon: -94.12 }, 60_000)).toBe(true));
  it("refreshes a stationary location at five minutes", () => expect(shouldRefreshPoint(initial, initial, 300_000)).toBe(true));
});

describe("independent model health", () => {
  const current: StormIntelState = { state: "DEGRADED", detail: "Point failed", checkedAt: 1, health: null, selectedPoint: { lat: 36, lon: -94 }, pointLoading: false, requestId: 1, pointSnapshot: null, pointError: "timeout", pointHistory: [] };
  it("does not overwrite point failure with a successful health check", () => {
    const result = mergeStormHealth(current, { state: "LIVE", detail: "Healthy", checkedAt: 2, health: {} });
    expect(result).toMatchObject({ state: "DEGRADED", detail: "Point failed", pointError: "timeout", serviceState: "LIVE", serviceDetail: "Healthy" });
  });
  it("does not overwrite a pending point request", () => {
    expect(mergeStormHealth({ ...current, state: "CHECKING", pointLoading: true }, { state: "LIVE", detail: "Healthy", checkedAt: 2, health: {} })).toMatchObject({ state: "CHECKING", pointLoading: true, serviceState: "LIVE" });
  });
});
