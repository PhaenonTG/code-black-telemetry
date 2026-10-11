import { afterEach, describe, expect, it, vi } from "vitest";
import { handleVerifiedSkyLive } from "./verifiedSkyLiveRelay";

afterEach(() => vi.unstubAllGlobals());

describe("CFHT live-state check", () => {
  it("reports live only while YouTube says the official stream is playing live", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"playabilityStatus":{"status":"OK"},"isLiveNow":true}', { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const request = new Request("https://ops.test/api/verified-sky-live");
    expect((await (await handleVerifiedSkyLive(request)).json() as { live: boolean }).live).toBe(true);
    fetcher.mockResolvedValue(new Response('{"playabilityStatus":{"status":"OK"},"isLiveNow":false}', { status: 200 }));
    expect((await (await handleVerifiedSkyLive(request)).json() as { live: boolean }).live).toBe(false);
  });
});
