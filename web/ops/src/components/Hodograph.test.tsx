import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SoundingHodographPoint } from "../core/types";
import { Hodograph } from "./Hodograph";

function representativePoints(): SoundingHodographPoint[] {
  return [
    { height_m: 365, u_ms: 2.0, v_ms: 1.0 },
    { height_m: 1017, u_ms: 8.1, v_ms: 4.5 },
    { height_m: 3299, u_ms: 18.2, v_ms: 10.5 },
    { height_m: 6023, u_ms: 24.1, v_ms: 14.5 },
    { height_m: 10101, u_ms: 32.0, v_ms: 18.0 },
  ];
}

describe("Hodograph", () => {
  it("renders a wind trace from real representative points", () => {
    const html = renderToString(<Hodograph points={representativePoints()} />);
    expect(html).toContain('class="hodograph__trace"');
  });

  it("shows an explicit empty state rather than an empty chart when there is no wind profile", () => {
    const html = renderToString(<Hodograph points={[]} />);
    expect(html).toContain("No wind profile available");
  });

  it("does not crash on a single-level profile", () => {
    expect(() => renderToString(<Hodograph points={[{ height_m: 300, u_ms: 5, v_ms: 2 }]} />)).not.toThrow();
  });
});
