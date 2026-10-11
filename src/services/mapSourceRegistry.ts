import type { TrafficCamera, SurfaceStationObservation } from "./mapLayerModels";
import type { NearbyPlace } from "./nearby";

export type MapSourceKind = "camera" | "surface_station" | "gas" | "lodging" | "hospital" | "food" | "landmark";
export type MapPinStatus = "visible" | "hidden" | "needs_review";

export interface MapSourceRecord {
  id: string;
  kind: MapSourceKind;
  provider_id: string;
  provider_record_id: string;
  name: string;
  city: string | null;
  state: string | null;
  latitude: number;
  longitude: number;
  address: string | null;
  source_url: string | null;
  attributes: Record<string, string | number | boolean | null>;
}

const CAMERA_STATES: Record<string, string> = {
  "ardot-idrive": "AR", "kandrive-kdot": "KS", "iadot-511": "IA",
  "tdot-smartway": "TN", "modot-traveler": "MO", "ne511-ndot": "NE",
  "cfht-verified-sky": "HI",
};

function isoTime(value: number | null | undefined): string | null {
  return value && Number.isFinite(value) && Math.abs(value) < 8.64e15 ? new Date(value).toISOString() : null;
}

export function cameraRegistryId(camera: TrafficCamera): string { return `camera:${camera.id}`; }
export function stationRegistryId(station: SurfaceStationObservation): string { return `surface_station:${station.provider.sourceId}:${station.id}`; }
export function placeRegistryId(place: NearbyPlace): string { return `${place.category}:osm:${place.id}`; }

export function cameraToMapSource(camera: TrafficCamera): MapSourceRecord {
  return {
    id: cameraRegistryId(camera), kind: "camera", provider_id: camera.providerId,
    provider_record_id: camera.providerRecordId, name: camera.name,
    city: null, state: CAMERA_STATES[camera.providerId] ?? null,
    latitude: camera.lat, longitude: camera.lon, address: camera.roadway,
    source_url: camera.sourceUrl,
    attributes: { roadway: camera.roadway, direction: camera.direction, availability: camera.availability, freshness: camera.freshness, last_frame_at: isoTime(camera.lastUpdateAt) },
  };
}

export function stationToMapSource(station: SurfaceStationObservation): MapSourceRecord {
  return {
    id: stationRegistryId(station), kind: "surface_station",
    provider_id: station.provider.sourceId, provider_record_id: station.id,
    name: station.name, city: null,
    state: station.provider.sourceId === "iadot-rwis" ? "IA" : null,
    latitude: station.lat, longitude: station.lon, address: station.roadway ?? null,
    source_url: station.provider.sourceId === "nws-asos" ? `https://www.weather.gov/wrh/timeseries?site=${encodeURIComponent(station.id)}` : null,
    attributes: { freshness: station.freshness, observed_at: isoTime(station.observedAt), temperature_f: station.temperatureF, dewpoint_f: station.dewpointF, wind_mph: station.windSpeedMph },
  };
}

export function placeToMapSource(place: NearbyPlace): MapSourceRecord {
  return {
    id: placeRegistryId(place), kind: place.category,
    provider_id: "openstreetmap", provider_record_id: place.id,
    name: place.name, city: place.city ?? null, state: place.state ?? null,
    latitude: place.lat, longitude: place.lon, address: place.address || null,
    source_url: `https://www.openstreetmap.org/${place.id}`,
    attributes: { hours: place.hoursText, hours_status: place.hoursStatus, phone: place.phone || null, beds: place.beds },
  };
}

export function shouldShowMapSource(status: MapPinStatus | undefined): boolean {
  return status !== "hidden" && status !== "needs_review";
}
