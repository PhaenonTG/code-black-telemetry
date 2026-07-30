export interface WindData {
  speedMph: number | null;
  gustMph: number | null;
  directionDeg: number | null;
  directionCardinal: string;
  source: TelemetrySource;
  updatedAt: number;
}

export interface WeatherData {
  tempF: number | null;
  dewpointF: number | null;
  humidity: number | null;
  pressureMb: number | null;
  pressureTrend: "rising" | "steady" | "falling" | null;
  rainRateInHr: number | null;
  rainTotalIn: number | null;
  source: TelemetrySource;
  sourceLabel: string;
  updatedAt: number;
}

export interface GpsData {
  speedMph: number | null;
  headingDeg: number | null;
  headingCardinal: string;
  elevationFt: number | null;
  accuracyM: number | null;
  hdop: number | null;
  satellites: number | null;
  hasFix: boolean;
  lat: number;
  lon: number;
  source: GpsSource;
  updatedAt: number;
}

export interface SensorHealth {
  id: string;
  label: string;
  online: boolean;
  lastPacketAt: number;
  packetRateHz: number;
}

export interface PowerData {
  mainBatteryV: number;
  auxBatteryV: number;
  charging: boolean;
  updatedAt: number;
}

export interface SystemData {
  cpuPercent: number;
  ramPercent: number;
  storagePercent: number;
  uptimeSeconds: number;
  updatedAt: number;
}

export interface StatusData {
  apiLatencyMs: number;
  dataAgeSeconds: number;
  piOnline: boolean;
  internetOnline: boolean;
  mode: "pi" | "tablet" | "simulator";
  updatedAt: number;
}

export interface EventEntry {
  id: string;
  timestamp: number;
  level: "info" | "warn" | "error";
  message: string;
}

export interface TelemetrySnapshot {
  wind: WindData;
  weather: WeatherData;
  gps: GpsData;
  sensors: SensorHealth[];
  power: PowerData;
  system: SystemData;
  status: StatusData;
  events: EventEntry[];
}

export type TelemetrySource = "vehicle" | "external" | "last-known" | "simulator" | "unavailable";
export type GpsSource = "vehicle" | "esp" | "tablet" | "last-known" | "simulator";
export type FreshnessState = "LIVE" | "RECENT" | "STALE" | "FALLBACK" | "OFFLINE";

export interface TabletLocationInput {
  lat: number;
  lon: number;
  accuracyM: number | null;
  speedMph: number | null;
  headingDeg: number | null;
  elevationFt: number | null;
  updatedAt: number;
}

export interface TelemetryProvider {
  subscribe(callback: (snapshot: TelemetrySnapshot) => void): () => void;
  getLatest(): TelemetrySnapshot;
  disconnect(): void;
}
