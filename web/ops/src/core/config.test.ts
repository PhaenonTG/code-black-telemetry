import { describe, expect, it } from "vitest";
import { coreConfigured, readOpsCoreConfig } from "./config";

describe("OPS Core config", () => {
  it("defaults to the same-origin authenticated Core gateway when no build URL is configured", () => {
    const config = readOpsCoreConfig({});
    expect(config.mode).toBe("LIVE_CORE");
    expect(config.coreBaseUrl).toBe("/api/core");
    expect(config.coreWsUrl).toBe("");
    expect(coreConfigured(config)).toBe(true);
  });

  it("keeps simulation explicit and never masquerades as live", () => {
    const config = readOpsCoreConfig({ VITE_OPS_DATA_MODE: "SIMULATION", VITE_CODEBLACK_CORE_BASE_URL: "https://core.example/" });
    expect(config.mode).toBe("SIMULATION");
    expect(config.coreBaseUrl).toBe("https://core.example");
    expect(coreConfigured(config)).toBe(false);
  });

  it("derives a websocket URL from the configured HTTPS Core base when not supplied", () => {
    const config = readOpsCoreConfig({ VITE_CODEBLACK_CORE_BASE_URL: "https://codeblack-core.tail.example/" });
    expect(config.coreWsUrl).toBe("wss://codeblack-core.tail.example");
  });
});
