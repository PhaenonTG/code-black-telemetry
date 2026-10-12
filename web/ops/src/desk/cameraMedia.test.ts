import { describe, it, expect } from "vitest"
import { cameraMedia, refreshedSnapshot, snapshotUsesProviderCache } from "./cameraMedia"
import type { TrafficCamera } from "../../../../src/services/mapLayerModels"
const camera = (streamUrl: string | null, imageUrl: string | null = "https://example.com/image.jpg") => ({ streamUrl, imageUrl } as TrafficCamera)
describe("camera media integrity", () => {
  it("recognizes relayed ARDOT HLS and signed playlists", () => {
    expect(cameraMedia(camera("/api/ardot-camera-stream?url=encoded")).kind).toBe("hls")
    expect(cameraMedia(camera("https://example.com/live.m3u8?token=abc")).kind).toBe("hls")
  })
  it("does not classify recorded MP4s as live streams", () => {
    expect(cameraMedia(camera("https://example.com/recording.mp4")).kind).toBe("video")
    expect(cameraMedia(camera("https://example.com/live.mjpg")).kind).toBe("mjpeg")
  })
  it("prefers snapshots in low bandwidth mode and reports missing media", () => {
    expect(cameraMedia(camera("https://example.com/live.m3u8"), true).kind).toBe("image")
    expect(cameraMedia(camera(null, null)).kind).toBe("unavailable")
  })
  it("reloads unsigned snapshots without altering signed camera tokens", () => {
    expect(refreshedSnapshot("https://example.com/image?camera=2", 100)).toBe("https://example.com/image?camera=2&_cb_frame=100")
    expect(refreshedSnapshot("https://example.com/image?X-Amz-Signature=abc", 100)).toBe("https://example.com/image?X-Amz-Signature=abc")
    expect(refreshedSnapshot(null, 100)).toBeUndefined()
    expect(snapshotUsesProviderCache("https://example.com/image?token=abc")).toBe(true)
    expect(snapshotUsesProviderCache("https://example.com/image?camera=2")).toBe(false)
  })
})
