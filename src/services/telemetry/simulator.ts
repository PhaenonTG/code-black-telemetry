import type { TelemetryProvider, TelemetrySnapshot, EventEntry } from "./types";

const TICK_MS = 1000;

function cardinalFromDeg(deg: number): string {
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

function clamp(val: number, min: number, max: number) {
  return Math.min(max, Math.max(min, val));
}

function walk(current: number, step: number, min: number, max: number): number {
  return clamp(current + (Math.random() - 0.5) * step * 2, min, max);
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 9);
}

const EVENT_MESSAGES = [
  ["info",  "GPS fix acquired"],
  ["info",  "nav-esp heartbeat OK"],
  ["info",  "wx-esp heartbeat OK"],
  ["warn",  "Wind sensor briefly unresponsive"],
  ["info",  "Battery voltage nominal"],
  ["info",  "System uptime milestone: 1 hour"],
  ["warn",  "High CPU load detected"],
  ["info",  "Data sync complete"],
  ["error", "Packet loss on nav-esp (recovered)"],
  ["info",  "GPS satellites: 9"],
] as const;

function buildInitialSnapshot(): TelemetrySnapshot {
  return {
    wind: {
      speedMph: 8,
      gustMph: 14,
      directionDeg: 220,
      directionCardinal: "SW",
      source: "simulator",
      updatedAt: Date.now(),
    },
    weather: {
      tempF: 72,
      dewpointF: 58,
      humidity: 62,
      pressureMb: 1012.4,
      pressureTrend: "steady",
      rainRateInHr: 0,
      rainTotalIn: 0.03,
      source: "simulator",
      sourceLabel: "SIMULATOR",
      updatedAt: Date.now(),
    },
    gps: {
      speedMph: 0,
      headingDeg: 180,
      headingCardinal: "S",
      elevationFt: 820,
      accuracyM: 4,
      hdop: 0.9,
      satellites: 9,
      hasFix: true,
      lat: 34.9514,
      lon: -81.9571,
      source: "simulator",
      updatedAt: Date.now(),
    },
    sensors: [
      { id: "nav-esp", label: "nav-esp", online: true, lastPacketAt: Date.now(), packetRateHz: 10 },
      { id: "wx-esp",  label: "wx-esp",  online: true, lastPacketAt: Date.now(), packetRateHz: 1  },
    ],
    power: {
      mainBatteryV: 12.6,
      auxBatteryV: 12.4,
      charging: false,
      updatedAt: Date.now(),
    },
    system: {
      cpuPercent: 18,
      ramPercent: 34,
      storagePercent: 42,
      uptimeSeconds: 3600,
      updatedAt: Date.now(),
    },
    status: {
      apiLatencyMs: 12,
      dataAgeSeconds: 0,
      piOnline: true,
      internetOnline: true,
      mode: "simulator",
      updatedAt: Date.now(),
    },
    events: [
      { id: randomId(), timestamp: Date.now() - 5000, level: "info", message: "System started" },
      { id: randomId(), timestamp: Date.now() - 3000, level: "info", message: "GPS fix acquired" },
      { id: randomId(), timestamp: Date.now() - 1000, level: "info", message: "All sensors online" },
    ],
  };
}

export class SimulatorProvider implements TelemetryProvider {
  private snapshot: TelemetrySnapshot;
  private subscribers: Set<(s: TelemetrySnapshot) => void> = new Set();
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickCount = 0;

  constructor() {
    this.snapshot = buildInitialSnapshot();
    this.start();
  }

  private start() {
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private tick() {
    this.tickCount++;
    const now = Date.now();
    const s = this.snapshot;

    // Wind — slow random walk
    const windDir = ((s.wind.directionDeg ?? 0) + (Math.random() - 0.5) * 6 + 360) % 360;
    const windSpeed = walk(s.wind.speedMph ?? 0, 0.8, 0, 40);
    const windGust  = clamp(windSpeed + walk((s.wind.gustMph ?? windSpeed) - windSpeed, 0.5, 0, 20), windSpeed, windSpeed + 20);

    // GPS — simulate slow vehicle movement
    const gpsSpeed = walk(s.gps.speedMph ?? 0, 2, 0, 80);
    const gpsHead  = ((s.gps.headingDeg ?? 0) + (Math.random() - 0.5) * 4 + 360) % 360;
    const sats     = clamp(Math.round((s.gps.satellites ?? 8) + (Math.random() > 0.9 ? (Math.random() > 0.5 ? 1 : -1) : 0)), 4, 12);

    // System
    const cpu = walk(s.system.cpuPercent, 3, 5, 95);
    const ram = walk(s.system.ramPercent, 1, 20, 90);

    // Battery — very slow drift
    const mainV = clamp(s.power.mainBatteryV + (Math.random() - 0.5) * 0.02, 11.8, 14.4);
    const auxV  = clamp(s.power.auxBatteryV  + (Math.random() - 0.5) * 0.02, 11.6, 14.2);

    // API latency
    const latency = clamp(Math.round(s.status.apiLatencyMs + (Math.random() - 0.5) * 8), 2, 200);

    // Sensor heartbeats
    const sensors = s.sensors.map(sen => ({
      ...sen,
      lastPacketAt: now,
      packetRateHz: clamp(sen.packetRateHz + (Math.random() - 0.5) * 0.2, 0.5, 12),
    }));

    // Occasional events (every ~30s)
    let events = s.events;
    if (this.tickCount % 30 === 0) {
      const [level, message] = EVENT_MESSAGES[Math.floor(Math.random() * EVENT_MESSAGES.length)];
      const newEvent: EventEntry = { id: randomId(), timestamp: now, level, message };
      events = [newEvent, ...s.events].slice(0, 50);
    }

    this.snapshot = {
      wind: { speedMph: windSpeed, gustMph: windGust, directionDeg: windDir, directionCardinal: cardinalFromDeg(windDir), source: "simulator", updatedAt: now },
      weather: {
        ...s.weather,
        humidity: clamp(Math.round((s.weather.humidity ?? 60) + (Math.random() - 0.5) * 0.5), 20, 100),
        pressureMb: clamp((s.weather.pressureMb ?? 1012) + (Math.random() - 0.5) * 0.08, 980, 1045),
        updatedAt: now,
      },
      gps: { ...s.gps, speedMph: gpsSpeed, headingDeg: gpsHead, headingCardinal: cardinalFromDeg(gpsHead), satellites: sats, hasFix: sats >= 4, lat: s.gps.lat, lon: s.gps.lon, updatedAt: now },
      sensors,
      power: { mainBatteryV: mainV, auxBatteryV: auxV, charging: mainV > 13.5, updatedAt: now },
      system: { cpuPercent: cpu, ramPercent: ram, storagePercent: s.system.storagePercent, uptimeSeconds: s.system.uptimeSeconds + 1, updatedAt: now },
      status: { apiLatencyMs: latency, dataAgeSeconds: 0, piOnline: true, internetOnline: true, mode: "simulator", updatedAt: now },
      events,
    };

    this.subscribers.forEach(cb => cb(this.snapshot));
  }

  subscribe(callback: (s: TelemetrySnapshot) => void) {
    this.subscribers.add(callback);
    callback(this.snapshot);
    return () => this.subscribers.delete(callback);
  }

  getLatest() { return this.snapshot; }

  disconnect() {
    if (this.timer) clearInterval(this.timer);
    this.subscribers.clear();
  }
}
