import { describe, expect, it } from "vitest";
import { handlePublicTropicalDiscovery, toPublicTropicalDiscovery } from "./publicTropicalDiscovery";

const sample = {
  status: "ready", freshness: "current", checked_at: "2026-10-10T06:00:00Z",
  source_times: { atlantic: "2026-10-10T05:00:00Z" },
  active_storms: [{ id: "al092026", name: "Isaias", basin: "atlantic", classification: "HU", intensity_kt: 95,
    last_update: "2026-10-10T05:00:00Z", freshness: "current", advisory_url: "https://www.nhc.noaa.gov/text/MIATCPAT4.shtml",
    private_operator_note: "family address secret", reported_centers: [{ latitude: 30.4, longitude: -88.3 }] }],
  outlook_areas: [{ key: "eastern_pacific:test", basin: "eastern_pacific", title: "South of Guatemala",
    issued_at: "2026-10-10T05:00:00Z", source_url: "https://www.nhc.noaa.gov/gtwo.php?basin=epac",
    formation_chance: { "48_hours": { percent: 0 }, "7_days": { percent: 70 } },
    description: "private note", geometry: { type: "Polygon", coordinates: [[[0, 0]]] } }],
};

describe("public tropical discovery boundary", () => {
  it("exposes only bounded NHC status and formation chances, never raw notes or geometry", () => {
    const result = toPublicTropicalDiscovery(sample);
    expect(result.active_storms).toHaveLength(1);
    expect(result.outlook_areas[0].chance_7d).toBe(70);
    expect(result.outlook_areas[0].kind).toBe("nhc_development_outlook_area_not_a_forecast_track");
    expect(JSON.stringify(result)).not.toMatch(/family address secret|private note|coordinates|reported_centers/);
  });
  it("rejects non-NHC links and invalid probabilities", () => {
    const input = structuredClone(sample);
    input.active_storms[0].advisory_url = "https://example.com/fake";
    input.outlook_areas[0].source_url = "javascript:alert(1)";
    input.outlook_areas[0].formation_chance["7_days"].percent = 120;
    const result = toPublicTropicalDiscovery(input);
    expect(result.active_storms[0].advisory_url).toBeNull();
    expect(result.outlook_areas[0].source_url).toBeNull();
    expect(result.outlook_areas[0].chance_7d).toBeNull();
  });
  it("supports CORS for Tropics without allowing writes", async () => {
    const request = new Request("https://ops.codeblackwx.com/api/public/tropical-discovery", { method: "POST", headers: { Origin: "https://tropics.codeblackwx.com" } });
    const response = await handlePublicTropicalDiscovery(request, {});
    expect(response.status).toBe(405);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://tropics.codeblackwx.com");
  });
});
