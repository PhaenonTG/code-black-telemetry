import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PointInspector } from "./PointInspector";
import type { OpsCoreState } from "../core/types";

function state(): OpsCoreState {
  const now = Date.now();
  return {
    refreshedAt: now,
    core: { state: "UNAVAILABLE", detail: "Core URL is not configured", checkedAt: now },
    fabric: {
      state: "UNAVAILABLE",
      detail: "Fabric unavailable",
      checkedAt: now,
      health: null,
      units: null,
      wsState: "disabled",
      lastWsEventAt: null,
      lastContactAt: null,
      error: null,
    },
    stormIntel: {
      state: "UNAVAILABLE",
      detail: "Storm Intel unavailable",
      checkedAt: now,
      health: null,
      selectedPoint: null,
      pointLoading: false,
      requestId: 0,
      pointSnapshot: null,
      pointError: null,
      pointHistory: [],
    },
  };
}

describe("PointInspector", () => {
  it("renders selected point and future sounding/consensus boundaries without fake data", () => {
    const html = renderToString(<PointInspector selectedPoint={{ lat: 36.45, lon: -94.12 }} coreState={state()} />);
    expect(html).toContain("36.450");
    expect(html).toContain("Vertical profile endpoint not yet available");
    expect(html).toContain("Consensus chassis reserved");
    expect(html).toContain("UNAVAILABLE");
  });
});
