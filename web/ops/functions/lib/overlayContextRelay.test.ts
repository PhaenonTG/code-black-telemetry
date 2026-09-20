import { afterEach, describe, expect, it, vi } from "vitest";
import { clearOverlayContextCacheForTests, handleOverlayContextRequest } from "./overlayContextRelay";

const liveFabric = {
  units: [{ unit_id: "cbwx-unit-tessa", devices: [{ health_state: "LIVE", last_seen: "2026-09-20T04:00:00Z", latest: { lat: 38.5, lon: -97.5 } }] }],
};
const geojson = (label: string) => ({ features: [{ properties: { DN: 2, LABEL: label, LABEL2: `${label} Risk`, fill: "#ffff00", ISSUE_ISO: "2026-09-20T00:00:00Z", EXPIRE_ISO: "2026-09-21T00:00:00Z" }, geometry: { type: "Polygon", coordinates: [[[-98, 38], [-97, 38], [-97, 39], [-98, 39], [-98, 38]]] } }] });

afterEach(() => { clearOverlayContextCacheForTests(); vi.unstubAllGlobals(); });

describe("overlay context relay", () => {
  it("derives weather and SPC context from Fabric's live location", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("https://api.open-meteo.com")) return Response.json({ daily: { time: ["2026-09-20"], temperature_2m_max: [80], temperature_2m_min: [62], precipitation_probability_max: [45], weathercode: [95] } });
      if (url.includes("spc.noaa.gov")) return Response.json(geojson("SLGT"));
      throw new Error(`unexpected upstream ${url}`);
    }));
    const response = await handleOverlayContextRequest(new Request("https://ops.test/overlay-core/overlay-context/v1/nick"), {
      CORE_GATEWAY_WORKER: { fetch: async () => Response.json(liveFabric) },
    });
    const body = await response.json() as { available: boolean; forecast: { status: string; days: Array<{ high: number }> }; spc: { status: string; day1: { categorical: { label: string } } } };
    expect(response.status).toBe(200); expect(body.available).toBe(true);
    expect(body.forecast.status).toBe("available"); expect(body.forecast.days[0].high).toBe(80);
    expect(body.spc.status).toBe("available"); expect(body.spc.day1.categorical.label).toBe("SLGT");
  });

  it("does not call external providers without a live Fabric location", async () => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    const response = await handleOverlayContextRequest(new Request("https://ops.test/overlay-core/overlay-context/v1/nick"), {
      CORE_GATEWAY_WORKER: { fetch: async () => Response.json({ units: [{ unit_id: "cbwx-unit-tessa", devices: [{ health_state: "OFFLINE", latest: {} }] }] }) },
    });
    const body = await response.json() as { available: boolean; reason: string };
    expect(response.status).toBe(200); expect(body).toEqual(expect.objectContaining({ available: false, reason: "FABRIC_LOCATION_UNAVAILABLE" }));
    expect(upstream).not.toHaveBeenCalled();
  });
});
