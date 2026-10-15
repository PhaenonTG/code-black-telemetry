import { describe, expect, it, vi } from "vitest";
import { privateProviderFetch } from "./private-provider-fetch";

describe("bounded private provider transport", () => {
  it("rejects non-provider URLs before any network call", async () => {
    const upstream = vi.fn<typeof fetch>();
    await expect(privateProviderFetch("https://example.test/api/Geojsons/workzones", {}, upstream)).rejects.toThrow("not allowed");
    await expect(privateProviderFetch("http://oktraffic.org/api/Geojsons/workzones", {}, upstream)).rejects.toThrow("not allowed");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("does not follow provider redirects or read advertised oversized bodies", async () => {
    const redirect = vi.fn<typeof fetch>().mockResolvedValue(Response.redirect("https://elsewhere.test/data"));
    await expect(privateProviderFetch("https://www.tdot.tn.gov/opendata/api/public/RoadwayWeather?case=redirect", {}, redirect)).rejects.toThrow("redirect rejected");
    expect(redirect.mock.calls[0][1]?.redirect).toBe("manual");
    const oversized = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { headers: { "Content-Length": "5000001" } }));
    await expect(privateProviderFetch("https://www.tdot.tn.gov/opendata/api/public/RoadwayWeather?case=oversized", {}, oversized)).rejects.toThrow("too large");
  });

  it("caches one validated response without asking the provider twice", async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"ok":true}', { headers: { "Content-Type": "application/json" } }));
    const url = "https://mapping.modot.org/arcgis/rest/services/TravelerInformation/NWSDATA/MapServer/0/query?case=private-cache";
    expect(await (await privateProviderFetch(url, {}, upstream)).json()).toEqual({ ok: true });
    expect(await (await privateProviderFetch(url, {}, upstream)).json()).toEqual({ ok: true });
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
