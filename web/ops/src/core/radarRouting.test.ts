import { afterEach, describe, expect, it, vi } from "vitest";
import { radarWorkerBase } from "../../../../src/services/radar";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("OPS radar relay routing", () => {
  it.each(["codeblack-ops.pages.dev", "mobile-preview.codeblack-ops.pages.dev"])("uses the public relay on %s", hostname => {
    vi.stubGlobal("window", { location: { hostname, origin: `https://${hostname}` } });
    expect(radarWorkerBase()).toBe("https://ops.codeblackwx.com");
  });
  it("keeps production same-origin", () => {
    vi.stubGlobal("window", { location: { hostname: "ops.codeblackwx.com", origin: "https://ops.codeblackwx.com" } });
    expect(radarWorkerBase()).toBe("https://ops.codeblackwx.com");
  });
  it("does not redirect unrelated deployments", () => {
    vi.stubGlobal("window", { location: { hostname: "localhost", origin: "http://localhost" } });
    vi.stubEnv("VITE_RADAR_WORKER_URL", "https://radar.example/");
    expect(radarWorkerBase()).toBe("https://radar.example");
  });
});
