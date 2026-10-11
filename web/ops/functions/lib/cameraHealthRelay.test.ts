import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCameraHealth } from "./cameraHealthRelay";

afterEach(() => vi.unstubAllGlobals());

describe("camera health relay", () => {
  it("rejects arbitrary hosts without fetching them", async () => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    const response = await handleCameraHealth(new Request("https://ops.test/api/camera-health?url=https%3A%2F%2Fexample.com%2Fcam.jpg"));
    expect(response.status).toBe(400); expect(upstream).not.toHaveBeenCalled();
  });

  it("returns a stable fingerprint for an allowed camera image", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "Content-Type": "image/jpeg" } })));
    const request = new Request("https://ops.test/api/camera-health?url=https%3A%2F%2Fatmsqf.iowadot.gov%2Fsnapshots%2Fcam.jpg");
    const first = await handleCameraHealth(request); const second = await handleCameraHealth(request);
    const firstBody = await first.json() as { fingerprint: string };
    const secondBody = await second.json() as { fingerprint: string };
    expect(first.status).toBe(200); expect(firstBody.fingerprint).toBe(secondBody.fingerprint); expect(firstBody.fingerprint).toHaveLength(24);
  });

  it("checks only NationCam's image host for the verified public embed", async () => {
    const upstream = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "image/jpeg", "Last-Modified": "Sun, 11 Oct 2026 16:21:25 GMT" } }));
    vi.stubGlobal("fetch", upstream);
    const response = await handleCameraHealth(new Request("https://ops.test/api/camera-health?url=https%3A%2F%2Fstreamer.nationcam.com%2Fmemfs%2F6d99ba5e-d0a6-4329-8383-858004604263.jpg"));
    expect(response.status).toBe(200);
    expect((await response.json() as { lastModified: string }).lastModified).toBe("Sun, 11 Oct 2026 16:21:25 GMT");
  });
});
