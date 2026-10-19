import type { ObservationProvenance } from "./mapLayerModels";

export type MeasurementUnit =
  | "degF"
  | "percent"
  | "mb"
  | "mph"
  | "deg"
  | "ft"
  | "in"
  | "count"
  | "unknown";

export type MeasurementQuality = "A" | "B" | "C" | "suspect" | "bad" | "unknown";

export interface QualifiedMeasurement {
  value: number | null;
  units: MeasurementUnit;
  quality: MeasurementQuality;
  observedAt: number | null;
  ageSeconds: number | null;
}

export interface MobileWeatherObservation {
  observationId: string;
  timestamp: number;
  latitude: QualifiedMeasurement;
  longitude: QualifiedMeasurement;
  altitude: QualifiedMeasurement;
  temperature: QualifiedMeasurement;
  relativeHumidity: QualifiedMeasurement;
  dewPoint: QualifiedMeasurement;
  stationPressure: QualifiedMeasurement;
  windSpeed: QualifiedMeasurement;
  windGust: QualifiedMeasurement;
  windDirection: QualifiedMeasurement;
  vehicleSpeed: QualifiedMeasurement;
  vehicleHeading: QualifiedMeasurement;
  rainfall?: QualifiedMeasurement;
  roadTemperature?: QualifiedMeasurement;
  lightning?: QualifiedMeasurement;
  solarRadiation?: QualifiedMeasurement;
  airQuality?: QualifiedMeasurement;
  provenance: ObservationProvenance;
}

export interface StationMeasurementQuality {
  temperature?: MeasurementQuality;
  pressure?: MeasurementQuality;
  humidity?: MeasurementQuality;
  wind?: MeasurementQuality;
  rainfall?: MeasurementQuality;
  roadTemperature?: MeasurementQuality;
  lightning?: MeasurementQuality;
  airQuality?: MeasurementQuality;
}

export interface MobileWeatherStationMetadata {
  nodeId: string;
  ownerMemberId: string | null;
  manufacturer: string;
  sensorModel: string;
  hardwareKind: "codeblack-native" | "custom" | "third-party";
  firmware: string | null;
  mountingDescription: string;
  mountingLocation: string;
  mountingHeightFt: number | null;
  aspirationMethod: string | null;
  calibrationDate: string | null;
  vehicleInformation: string | null;
  supportedCapabilities: string[];
  measurementQuality: StationMeasurementQuality;
  provenance: ObservationProvenance;
}

export const CODEBLACK_MESONET_PROVENANCE: ObservationProvenance = {
  provider: "CHASERNET/MESONET",
  sourceId: "codeblack-mobile-mesonet",
  sourceName: "Code Black Mobile Mesonet",
  official: false,
  experimental: true,
  displayLabel: "Code Black Chaser Net observation - non-official",
};
