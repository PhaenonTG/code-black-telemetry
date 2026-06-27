export interface WindData {
  speedMph: number;
  gustMph: number;
  directionDeg: number;
  directionCardinal: string;
  updatedAt: number;
}

export interface WeatherData {
  tempF: number;
  dewpointF: number;
  humidity: number;
  updatedAt: number;
}

export interface GpsData {
  speedMph: number;
  headingDeg: number;
  satellites: number;
  hasFix: boolean;
  lat: number;
  lon: number;
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

export interface TelemetryProvider {
  subscribe(callback: (snapshot: TelemetrySnapshot) => void): () => void;
  getLatest(): TelemetrySnapshot;
  disconnect(): void;
}
