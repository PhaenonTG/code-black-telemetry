import type { EventLevel, SimulationMode, TelemetryEvent, TelemetryProvider, TelemetrySnapshot } from "./types";

const TICK_MS = 1000;

const EVENT_MESSAGES: Array<[EventLevel, string]> = [
  ["info", "nav-esp packet received"],
  ["info", "wx-esp packet received"],
  ["info", "GPS fix stable"],
  ["warn", "Wind gust threshold exceeded"],
  ["warn", "API latency above target"],
  ["critical", "Simulated sensor offline"],
  ["info", "System heartbeat nominal"],
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function walk(value: number, step: number, min: number, max: number) {
  return clamp(value + (Math.random() - 0.5) * step * 2, min, max);
}

function cardinalFromDeg(deg: number) {
  const points = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return points[Math.round(deg / 22.5) % points.length];
}

function eventId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function newEvent(level: EventLevel, message: string, timestamp = Date.now()): TelemetryEvent {
  return { id: eventId(), timestamp, level, message };
}

function buildInitialSnapshot(): TelemetrySnapshot {
  const now = Date.now();
  return {
    mode: "live",
    wind: {
      speedMph: 17.4,
      gustMph: 25.9,
      directionDeg: 214,
      directionCardinal: "SW",
      updatedAt: now,
    },
    weather: {
      temperatureF: 78.2,
      dewpointF: 66.4,
      humidityPercent: 68,
      updatedAt: now,
    },
    gps: {
      speedMph: 42.1,
      headingDeg: 184,
      headingCardinal: "S",
      satellites: 11,
      hasFix: true,
      latitude: 35.4676,
      longitude: -97.5164,
      updatedAt: now,
    },
    sensors: [
      { id: "nav-esp", label: "nav-esp", online: true, lastPacketAt: now, packetRateHz: 9.8 },
      { id: "wx-esp", label: "wx-esp", online: true, lastPacketAt: now, packetRateHz: 1.1 },
    ],
    power: {
      mainBatteryV: 12.72,
      auxBatteryV: 12.48,
      charging: false,
      updatedAt: now,
    },
    system: {
      cpuPercent: 22,
      memoryPercent: 38,
      storagePercent: 44,
      uptimeSeconds: 13842,
      updatedAt: now,
    },
    status: {
      apiLatencyMs: 18,
      dataAgeSeconds: 0,
      piOnline: true,
      connectionState: "online",
      overallHealth: "nominal",
      vehicleName: "Code Black 1",
      updatedAt: now,
    },
    events: [
      newEvent("info", "Telemetry simulator started", now - 9000),
      newEvent("info", "GPS fix acquired", now - 7000),
      newEvent("info", "All simulated sensors online", now - 5000),
    ],
  };
}

export class SimulatorTelemetryProvider implements TelemetryProvider {
  private snapshot = buildInitialSnapshot();
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof window.setInterval> | null = null;
  private tickCount = 0;

  constructor() {
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot() {
    return this.snapshot;
  }

  setMode(mode: SimulationMode) {
    if (mode === this.snapshot.mode) return;
    this.snapshot = {
      ...this.snapshot,
      mode,
      events: [newEvent(mode === "live" ? "info" : "warn", `Simulation mode set to ${mode}`), ...this.snapshot.events].slice(0, 40),
    };
    this.emit();
  }

  disconnect() {
    if (this.timer) window.clearInterval(this.timer);
    this.listeners.clear();
  }

  private tick() {
    this.tickCount += 1;
    const current = this.snapshot;
    const now = Date.now();

    if (current.mode === "offline") {
      this.snapshot = {
        ...current,
        status: {
          ...current.status,
          dataAgeSeconds: Math.round((now - current.wind.updatedAt) / 1000),
          piOnline: false,
          connectionState: "offline",
          overallHealth: "critical",
          updatedAt: now,
        },
        sensors: current.sensors.map((sensor) => ({ ...sensor, online: false, packetRateHz: 0 })),
      };
      this.emit();
      return;
    }

    if (current.mode === "stale") {
      this.snapshot = {
        ...current,
        status: {
          ...current.status,
          dataAgeSeconds: Math.round((now - current.wind.updatedAt) / 1000),
          piOnline: true,
          connectionState: "degraded",
          overallHealth: "warning",
          apiLatencyMs: walk(current.status.apiLatencyMs, 25, 90, 850),
          updatedAt: now,
        },
        sensors: current.sensors.map((sensor) => ({ ...sensor, online: sensor.id === "nav-esp", packetRateHz: sensor.id === "nav-esp" ? 1.2 : 0 })),
      };
      this.emit();
      return;
    }

    const windDirection = (current.wind.directionDeg + (Math.random() - 0.5) * 7 + 360) % 360;
    const windSpeed = walk(current.wind.speedMph, 1.1, 1, 54);
    const gustDelta = walk(current.wind.gustMph - current.wind.speedMph, 0.7, 3, 24);
    const headingDeg = (current.gps.headingDeg + (Math.random() - 0.5) * 5 + 360) % 360;
    const speedMph = walk(current.gps.speedMph, 3.5, 0, 78);
    const latStep = Math.cos((headingDeg * Math.PI) / 180) * speedMph * 0.000004;
    const lonStep = Math.sin((headingDeg * Math.PI) / 180) * speedMph * 0.000004;
    const cpu = walk(current.system.cpuPercent, 4, 8, 82);
    const memory = walk(current.system.memoryPercent, 1.2, 26, 76);
    const latency = Math.round(walk(current.status.apiLatencyMs, 8, 4, 140));
    const health = cpu > 75 || latency > 110 ? "warning" : "nominal";

    let events = current.events;
    if (this.tickCount % 18 === 0) {
      const [level, message] = EVENT_MESSAGES[Math.floor(Math.random() * EVENT_MESSAGES.length)];
      events = [newEvent(level, message, now), ...events].slice(0, 40);
    }

    this.snapshot = {
      mode: "live",
      wind: {
        speedMph: windSpeed,
        gustMph: clamp(windSpeed + gustDelta, windSpeed, windSpeed + 28),
        directionDeg: windDirection,
        directionCardinal: cardinalFromDeg(windDirection),
        updatedAt: now,
      },
      weather: {
        temperatureF: walk(current.weather.temperatureF, 0.08, 30, 110),
        dewpointF: walk(current.weather.dewpointF, 0.06, 18, 82),
        humidityPercent: Math.round(walk(current.weather.humidityPercent, 0.8, 20, 98)),
        updatedAt: now,
      },
      gps: {
        speedMph,
        headingDeg,
        headingCardinal: cardinalFromDeg(headingDeg),
        satellites: Math.round(walk(current.gps.satellites, 0.3, 6, 14)),
        hasFix: true,
        latitude: current.gps.latitude + latStep,
        longitude: current.gps.longitude + lonStep,
        updatedAt: now,
      },
      sensors: current.sensors.map((sensor) => ({
        ...sensor,
        online: true,
        lastPacketAt: now,
        packetRateHz: walk(sensor.packetRateHz || (sensor.id === "nav-esp" ? 10 : 1), 0.16, sensor.id === "nav-esp" ? 8 : 0.7, sensor.id === "nav-esp" ? 12 : 1.4),
      })),
      power: {
        mainBatteryV: walk(current.power.mainBatteryV, 0.015, 11.8, 14.2),
        auxBatteryV: walk(current.power.auxBatteryV, 0.012, 11.6, 13.8),
        charging: current.power.mainBatteryV > 13.2,
        updatedAt: now,
      },
      system: {
        cpuPercent: cpu,
        memoryPercent: memory,
        storagePercent: walk(current.system.storagePercent, 0.03, 35, 92),
        uptimeSeconds: current.system.uptimeSeconds + 1,
        updatedAt: now,
      },
      status: {
        ...current.status,
        apiLatencyMs: latency,
        dataAgeSeconds: 0,
        piOnline: true,
        connectionState: "online",
        overallHealth: health,
        updatedAt: now,
      },
      events,
    };
    this.emit();
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }
}
