import type { MapViewport, ZoomDetailLevel } from "../map/viewport";

export type ObservationProviderKind =
  | "NOAA/NEXRAD"
  | "NOAA/GOES"
  | "HRRR"
  | "OFFICIAL/STATE_TRANSPORTATION"
  | "CHASERNET/HUMAN"
  | "CHASERNET/MESONET"
  | "CODEBLACK/PROBE"
  | "PUBLIC/TRAFFIC"
  | "ROAD/PROVIDER";

export interface ObservationProvenance {
  provider: ObservationProviderKind;
  sourceId: string;
  sourceName: string;
  official: boolean;
  experimental: boolean;
  displayLabel: string;
}

export interface LayerQueryContext {
  viewport: MapViewport;
  detail: ZoomDetailLevel;
  sessionId: string | null;
}

export type RoadConditionKind =
  | "closure"
  | "crash"
  | "flooding"
  | "construction"
  | "winter-condition"
  | "debris-hazard"
  | "disabled-vehicle"
  | "weather-hazard"
  | "fire-smoke-impact"
  | "utility-power-issue"
  | "other"
  | "unknown";

export type RoadClosureState = "open" | "lane-restricted" | "closed" | "unknown";
export type RoadEventSeverity = "informational" | "low" | "medium" | "high" | "critical" | "unknown";
export type RoadTravelDirection = "northbound" | "southbound" | "eastbound" | "westbound" | "both" | "unknown";
export type LayerFreshnessState = "fresh" | "aging" | "stale" | "unavailable";

export type LayerGeometry =
  | { type: "point"; lat: number; lon: number }
  | { type: "line"; coordinates: Array<{ lat: number; lon: number }> }
  | { type: "polygon"; rings: Array<Array<{ lat: number; lon: number }>> };

export interface RoadConditionEvent {
  id: string;
  providerId: string;
  providerRecordId: string;
  kind: RoadConditionKind;
  geometry: LayerGeometry;
  closureState: RoadClosureState;
  severity: RoadEventSeverity;
  title: string;
  startsAt: number | null;
  endsAt: number | null;
  direction: RoadTravelDirection;
  roadway: string | null;
  status: string;
  description: string;
  lat: number;
  lon: number;
  provider: ObservationProvenance;
  updatedAt: number;
  freshness: LayerFreshnessState;
  stale: boolean;
  sourceUrl: string | null;
  rawSourceReference: string | null;
}

export type TrafficCameraAvailability = "available" | "stale" | "offline" | "unknown";

export interface TrafficCamera {
  id: string;
  providerId: string;
  providerRecordId: string;
  name: string;
  lat: number;
  lon: number;
  roadway: string | null;
  direction: string | null;
  source: string;
  provider: ObservationProvenance;
  lastUpdateAt: number | null;
  imageUrl: string | null;
  streamUrl: string | null;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  availability: TrafficCameraAvailability;
  freshness: LayerFreshnessState;
  sourceUrl: string | null;
  attribution: string;
}

export interface ProbeObservation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  temperatureF: number | null;
  dewpointF: number | null;
  pressureMb: number | null;
  windSpeedMph: number | null;
  windGustMph: number | null;
  windDirectionDeg: number | null;
  batteryPercent: number | null;
  linkStatus: "online" | "stale" | "offline" | "unknown";
  observedAt: number;
  chaseSessionId: string | null;
  quality: "good" | "suspect" | "bad" | "unknown";
  provider: ObservationProvenance;
}

export interface ViewportLayerResult<T> {
  data: T[];
  status: "ready" | "empty" | "stale" | "outside-coverage" | "not-configured" | "unavailable" | "error";
  message: string;
  simulated: boolean;
  fetchedAt: number;
  stale?: boolean;
  providerIds?: string[];
}

const notConfiguredProvider = (name: string): ObservationProvenance => ({
  provider: "ROAD/PROVIDER",
  sourceId: "not-configured",
  sourceName: name,
  official: false,
  experimental: false,
  displayLabel: `${name} not configured`,
});

export { getRoadConditionsForViewport, getTrafficCamerasForViewport, fetchKandriveLiveCameraSource } from "./roadCameraProviders";

export async function getProbesForViewport(_context: LayerQueryContext): Promise<ViewportLayerResult<ProbeObservation>> {
  return { data: [], status: "not-configured", message: "Code Black probe provider not configured.", simulated: false, fetchedAt: Date.now() };
}

export const ROAD_CONDITIONS_PROVENANCE = notConfiguredProvider("Road conditions");
