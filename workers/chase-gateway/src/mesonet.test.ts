import { describe, expect, it, vi } from "vitest";
import { handleRequest } from "./index";

describe("mesonet gateway", () => {
  it("forwards only the device bearer to the fixed private ingest route", async () => {
    const fetch = vi.fn(async (_url: string | URL, _init?: RequestInit) => new Response('{"accepted":true}'));
    const request = new Request("https://ops.codeblackwx.com/api/chase/mesonet/ingest", {
      method: "POST", headers: { Authorization: "Bearer device-only" }, body: "{}",
    });
    const response = await handleRequest(request, { CORE_VPC: { fetch } });
    expect(response.status).toBe(200);
    expect(fetch.mock.calls[0][0]).toBe("http://127.0.0.1:8000/api/mesonet/v1/ingest");
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer device-only");
  });
  it("rejects unauthenticated and oversized ingest before forwarding", async () => {
    const fetch = vi.fn(async () => new Response("{}"));
    const env = { CORE_VPC: { fetch } };
    expect((await handleRequest(new Request("https://x/api/chase/mesonet/ingest", {
      method: "POST", body: "{}",
    }), env)).status).toBe(401);
    expect((await handleRequest(new Request("https://x/api/chase/mesonet/ingest", {
      method: "POST", headers: { Authorization: "Bearer x" }, body: "x".repeat(4097),
    }), env)).status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("public projection hides location, credentials, and unverified wind", async () => {
    const fetch = vi.fn(async () => Response.json({
      wind: { readings: { wind_mps: 10 }, calibration_verified: false },
      weather: { readings: { temperature_c: 0, latitude: 36, humidity_pct: 50 } },
      token: "never-public",
    }));
    const response = await handleRequest(new Request("https://x/api/chase/mesonet/public"), {
      CORE_VPC: { fetch }, MESONET_READ_TOKEN: "server-read",
    });
    const result = await response.json() as Record<string, unknown>;
    expect(result.temperature_c).toBe(0);
    expect(result.wind_mps).toBeNull();
    expect(JSON.stringify(result)).not.toContain("never-public");
    expect(result).not.toHaveProperty("latitude");
  });
});
