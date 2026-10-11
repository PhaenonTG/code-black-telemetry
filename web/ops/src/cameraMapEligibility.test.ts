import { afterEach, describe, expect, it, vi } from "vitest";
import type { LayerQueryContext, TrafficCamera } from "../../../src/services/mapLayerModels";
import { cameraMapEligibility } from "../../../src/services/cameraMapEligibility";
import { fetchVerifiedCfhtSkyCameraForViewport, fetchVerifiedSkyCamerasForViewport } from "../../../src/services/verifiedSkyCameras";

const viewport = { viewport: { north: 30, south: 28, east: -88, west: -90, zoom: 7 } } as LayerQueryContext;
const camera = {
  id: "test:camera:1", providerId: "test", availability: "available", freshness: "fresh", imageUrl: "https://example.com/image.jpg",
} as TrafficCamera;

afterEach(() => vi.unstubAllGlobals());

describe("camera map publication", () => {
  it("keeps source records but suppresses offline, media-less and audited low-value pins", () => {
    expect(cameraMapEligibility(camera).eligible).toBe(true);
    expect(cameraMapEligibility({ ...camera, availability: "offline" }).eligible).toBe(false);
    expect(cameraMapEligibility({ ...camera, imageUrl: null }).eligible).toBe(false);
    expect(cameraMapEligibility({ ...camera, id: "iadot-511:camera:59634486" }).eligible).toBe(false);
  });

  it("publishes the Gulf sky camera only for a recent source image", async () => {
    vi.stubGlobal("window", {});
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, bytes: 60_000, lastModified: new Date(Date.now() - 60_000).toUTCString() }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    expect(await fetchVerifiedSkyCamerasForViewport(viewport)).toHaveLength(1);
    fetcher.mockResolvedValue(new Response(JSON.stringify({ ok: true, bytes: 60_000, lastModified: new Date(Date.now() - 60 * 60_000).toUTCString() }), { status: 200 }));
    expect(await fetchVerifiedSkyCamerasForViewport(viewport)).toEqual([]);
  });

  it("publishes the CFHT camera only while its broadcast is live", async () => {
    vi.stubGlobal("window", {});
    const hawaii = { viewport: { north: 20, south: 19, east: -155, west: -156, zoom: 8 } } as LayerQueryContext;
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ live: true, checkedAt: Date.now() }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    expect(await fetchVerifiedCfhtSkyCameraForViewport(hawaii)).toHaveLength(1);
    fetcher.mockResolvedValue(new Response(JSON.stringify({ live: false, checkedAt: Date.now() }), { status: 200 }));
    expect(await fetchVerifiedCfhtSkyCameraForViewport(hawaii)).toEqual([]);
  });
});
