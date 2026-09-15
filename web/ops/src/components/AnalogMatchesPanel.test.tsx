import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalogMatchesPanel } from "./AnalogMatchesPanel";
import { ANALOG_MATCHES_NOT_YET_AVAILABLE } from "../core/analogMatches";

describe("AnalogMatchesPanel", () => {
  it("defaults to the honest not-populated state -- never a fabricated example match", () => {
    const html = renderToString(<AnalogMatchesPanel />);
    expect(html).toContain("Not populated");
    expect(html).toContain("environmental resemblance only");
    expect(html).not.toContain("%</span>");
  });

  it("renders real matches when the (future) engine supplies them, similarity as a percentage", () => {
    const html = renderToString(
      <AnalogMatchesPanel
        result={{
          schemaVersion: "1.0.0",
          available: true,
          unavailableReason: null,
          matches: [
            {
              matchId: "case-1",
              similarityScore: 0.87,
              similarityBasis: "environmental_fingerprint_v1",
              matchedAt: "2019-05-20",
              matchedLocation: { displayName: "El Reno, OK", latitude: 35.53, longitude: -98.02 },
              historicalOutcome: null,
            },
          ],
        }}
      />,
    );
    expect(html).toContain("87%");
    expect(html).toContain("El Reno, OK");
  });

  it("shows the reserved contract version so a future engine mismatch is visible", () => {
    const html = renderToString(<AnalogMatchesPanel />);
    expect(html).toContain(`v${ANALOG_MATCHES_NOT_YET_AVAILABLE.schemaVersion}`);
  });
});
