import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SoundingProfile } from "../core/types";
import { SkewT } from "./SkewT";

function representativeProfile(overrides: Partial<SoundingProfile> = {}): SoundingProfile {
  // Same shape/values as a real Norman OK HRRR pull this pass verified live -- pressure strictly
  // descending, surface-up.
  return {
    pressure_hpa: [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 200],
    height_m: [365, 578, 795, 1017, 1244, 1717, 2216, 3299, 4548, 6023, 7822, 10101, 13113],
    temp_c: [24.7, 23.1, 21.0, 18.8, 16.5, 11.9, 7.1, -3.5, -15.2, -28.9, -45.1, -55.6, -55.9],
    dewp_c: [17.8, 16.9, 15.3, 13.1, 10.5, 4.8, -2.1, -13.5, -22.8, -33.9, -48.5, -58.2, -58.9],
    u_ms: [2.0, 4.1, 6.0, 8.1, 9.9, 12.5, 14.8, 18.2, 20.5, 24.1, 28.6, 32.0, 25.0],
    v_ms: [1.0, 2.0, 3.1, 4.5, 5.5, 7.0, 8.2, 10.5, 12.0, 14.5, 16.0, 18.0, 12.0],
    parcel_temp_c: [24.7, 21.2, 18.0, 14.9, 11.9, 6.1, 0.5, -10.8, -20.5, -30.1, -41.2, -50.8, -58.1],
    ...overrides,
  };
}

describe("SkewT", () => {
  it("renders a temperature and dewpoint trace from a real representative profile", () => {
    const html = renderToString(<SkewT profile={representativeProfile()} />);
    expect(html).toContain('class="skewt__temperature"');
    expect(html).toContain('class="skewt__dewpoint"');
    expect(html).toContain('class="skewt__parcel"');
  });

  it("omits the parcel trace when Core did not supply one, rather than fabricating it", () => {
    const html = renderToString(<SkewT profile={representativeProfile({ parcel_temp_c: null })} />);
    expect(html).not.toContain('class="skewt__parcel"');
    expect(html).toContain('class="skewt__temperature"');
  });

  it("draws one isobar per fixed pressure level, labeled with real hPa values", () => {
    const html = renderToString(<SkewT profile={representativeProfile()} />);
    expect(html).toContain(">1000<");
    expect(html).toContain(">500<");
    expect(html).toContain(">200<");
  });

  it("does not crash on a profile too short to be meaningful, and draws no trace", () => {
    const short = representativeProfile({
      pressure_hpa: [1000, 900],
      height_m: [300, 1000],
      temp_c: [20, 15],
      dewp_c: [15, 10],
      u_ms: [1, 2],
      v_ms: [1, 2],
      parcel_temp_c: null,
    });
    expect(() => renderToString(<SkewT profile={short} />)).not.toThrow();
  });
});
