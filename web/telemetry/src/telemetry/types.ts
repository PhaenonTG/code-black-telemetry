export type ConnectionState = "online" | "degraded" | "offline";
export type SimulationMode = "live" | "stale" | "offline";
export type EventLevel = "info" | "warn" | "critical";

export interface WindTelemetry {
  speedMph: number;
  gustMph: number;
  directionDeg: number;
  directionCardinal: string;
  updatedAt: number;
}

export interface WeatherTelemetry {
  temperatureF: number;
  dewpointF: number;
  humidityPercent: number;
  updatedAt: number;
}

export interface GpsTelemetry {
  speedMph: number;
  headingDeg: number;
  headingCardinal: string;
  satellites: number;
  hasFix: boolean;
  latitude: number;
  longitude: number;
  updatedAt: number;
}

export interface SensorHealthTelemetry {
  id: "nav-esp" | "wx-esp";
  label: string;
  online: boolean;
  lastPacketAt: number;
  packetRateHz: number;
}

export interface PowerTelemetry {
  mainBatteryV: number;
  auxBatteryV: number;
  charging: boolean;
  updatedAt: number;
}

export interface SystemTelemetry {
  cpuPercent: number;
  memoryPercent: number;
  storagePercent: number;
  uptimeSeconds: number;
  updatedAt: number;
}

export interface StatusTelemetry {
  apiLatencyMs: number;
  dataAgeSeconds: number;
  piOnline: boolean;
  connectionState: ConnectionState;
  overallHealth: "nominal" | "warning" | "critical";
  vehicleName: string;
  updatedAt: number;
}

export interface TelemetryEvent {
  id: string;
  timestamp: number;
  level: EventLevel;
  message: string;
}

export interface TelemetrySnapshot {
  mode: SimulationMode;
  wind: WindTelemetry;
  weather: WeatherTelemetry;
  gps: GpsTelemetry;
  sensors: SensorHealthTelemetry[];
  power: PowerTelemetry;
  system: SystemTelemetry;
  status: StatusTelemetry;
  events: TelemetryEvent[];
}

export interface TelemetryProvider {
  subscribe(listener: () => void): () => void;
  getSnapshot(): TelemetrySnapshot;
  setMode(mode: SimulationMode): void;
  disconnect(): void;
}
