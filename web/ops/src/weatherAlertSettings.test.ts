import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "test-token" } } }) } },
}));

import { loadWeatherAlertRuntimeStatus, loadWeatherAlertSettings } from "./weatherAlertSettings";
import type { OpsCoreConfig } from "./core/config";

const config: OpsCoreConfig = {
  mode: "LIVE_CORE", coreBaseUrl: "/core-api", coreWsUrl: "", unitId: "cbwx-unit-striker",
  stormIntelPollSeconds: 30,
};

afterEach(() => vi.unstubAllGlobals());

describe("weather alert controls", () => {
  it("uses the configured Core base for settings and runtime status", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      urls.push(url);
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-token");
      return new Response(JSON.stringify({ schema: "test" }), { status: 200 });
    }));
    await loadWeatherAlertSettings(config);
    await loadWeatherAlertRuntimeStatus(config);
    expect(urls).toEqual([
      "/core-api/api/weather-alert/v1/settings",
      "/core-api/api/weather-alert/v1/status",
    ]);
  });

  it("does not request controls when Core is unconfigured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadWeatherAlertSettings({ ...config, coreBaseUrl: "" })).rejects.toThrow("Core gateway is unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
