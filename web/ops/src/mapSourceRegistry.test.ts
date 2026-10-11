import { describe, expect, it } from "vitest";
import { cameraRegistryId, cameraToMapSource, placeRegistryId, placeToMapSource, shouldShowMapSource, stationRegistryId, stationToMapSource } from "../../../src/services/mapSourceRegistry";
import { cameraMapEligibility } from "../../../src/services/cameraMapEligibility";
import type { TrafficCamera, SurfaceStationObservation } from "../../../src/services/mapLayerModels";
import type { NearbyPlace } from "../../../src/services/nearby";

const camera = {
  id: "iadot-511:camera:59634486", providerId: "iadot-511", providerRecordId: "59634486", name: "Williams RWIS",
  lat: 42.1, lon: -93.1, roadway: "I-35", sourceUrl: "https://example.org/camera",
  availability: "available", freshness: "fresh", imageUrl: "https://example.org/image.jpg",
  streamUrl: null, thumbnailUrl: null, previewUrl: null,
} as TrafficCamera;

const station = { id: "KXNA", name: "Northwest Arkansas", lat: 36.28, lon: -94.3, roadway: null, provider: { sourceId: "nws-asos" } } as SurfaceStationObservation;
const place = { id: "way/123", category: "lodging", name: "Test Hotel", lat: 36.3, lon: -94.2, city: "Bentonville", state: "AR", address: "1 Main St, Bentonville, AR" } as NearbyPlace;

describe("map source registry identity and map review", () => {
  it("uses stable provider IDs and records provenance", () => {
    expect(cameraRegistryId(camera)).toBe("camera:iadot-511:camera:59634486");
    expect(cameraToMapSource(camera)).toMatchObject({ kind: "camera", provider_id: "iadot-511", state: "IA", latitude: 42.1 });
    expect(stationRegistryId(station)).toBe("surface_station:nws-asos:KXNA");
    expect(stationToMapSource(station).source_url).toContain("site=KXNA");
    expect(placeRegistryId(place)).toBe("lodging:osm:way/123");
    expect(placeToMapSource(place)).toMatchObject({ city: "Bentonville", state: "AR", source_url: "https://www.openstreetmap.org/way/123" });
  });

  it("hides a reviewed point without deleting its provider record", () => {
    expect(shouldShowMapSource("hidden")).toBe(false);
    expect(shouldShowMapSource("needs_review")).toBe(false);
    expect(shouldShowMapSource("visible")).toBe(true);
    expect(cameraMapEligibility(camera).eligible).toBe(false); // legacy Oct 11 review
    expect(cameraMapEligibility(camera, "visible").eligible).toBe(true); // operator can supersede it
    expect(cameraMapEligibility(camera, "hidden").eligible).toBe(false);
  });
});
