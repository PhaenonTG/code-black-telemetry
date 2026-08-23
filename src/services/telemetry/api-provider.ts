import { SimulatorProvider } from "./simulator";
import type { GpsData, PowerData, SystemData, TabletLocationInput, TelemetryProvider, TelemetrySnapshot, WeatherData, WindData } from "./types";
import { cardinalFromDeg, isFiniteNumber, readEvents, readNumber, readNumberInRange, readSensors, readString, readTimestamp } from "./quality";
import { getPiEndpoint, getTelemetryLinkEnabled, loadPiEndpoint, loadTelemetryLinkEnabled, subscribePiEndpoint, subscribeTelemetryLinkEnabled } from "../settings";
import { Preferences } from "@capacitor/preferences";
import { bleTelemetryClient, type BleTelemetryPayload } from "./ble-client";
import {
  classifyFetchError,
  classifyHttpStatus,
  createConnectionStatus,
  dataFreshnessState,
  fetchWithTimeout,
  inferConnectionTransport,
  nextBackoffDelayMs,
  normalizeEndpointOrEmpty,
  type ConnectionStatus,
} from "../connection";

const POLL_MS = 2000;
const GPS_MAX_AGE_MS = 15_000;
const LAST_SNAPSHOT_KEY = "codeblack.lastTelemetrySnapshot";
const SIMULATOR_ALLOWED = import.meta.env.DEV && import.meta.env.VITE_ALLOW_SIMULATOR === "true";
// BLE server-side ticks telemetry every ~1s (codeblack-ble.service, CB_BLE_TELEMETRY_SECONDS=1) --
// a window a few ticks wide tolerates a missed notification or two without falling through to the
// HTTP poll, which is usually unconfigured anyway since avoiding a WiFi/Starlink dependency is the
// entire point of the BLE link.
const BLE_FRESH_WINDOW_MS = 6_000;
const BLE_UNHEALTHY_STATUSES = new Set(["OFFLINE", "UNAVAILABLE", "UNTRUSTED"]);

function celsiusToFahrenheit(value: number | null): number | null {
  return value == null ? null : (value * 9) / 5 + 32;
}

function bleFieldOk(status: string | null | undefined): boolean {
  return status != null && !BLE_UNHEALTHY_STATUSES.has(status.toUpperCase());
}

function normalizeBleSnapshot(payload: BleTelemetryPayload, fallback: TelemetrySnapshot, now: number): TelemetrySnapshot {
  const gpsOk = bleFieldOk(payload.gps?.st) && validCoord(payload.gps?.lat ?? null, payload.gps?.lon ?? null);
  const wxOk = bleFieldOk(payload.wx?.st);
  const windOk = bleFieldOk(payload.wind?.st);
  return {
    wind: windOk
      ? {
          speedMph: payload.wind.spd,
          gustMph: payload.wind.gust,
          directionDeg: payload.wind.dir,
          directionCardinal: cardinalFromDeg(payload.wind.dir),
          source: "vehicle",
          updatedAt: now,
        }
      : fallback.wind,
    weather: wxOk
      ? {
          tempF: celsiusToFahrenheit(payload.wx.t_c),
          dewpointF: celsiusToFahrenheit(payload.wx.dp_c),
          humidity: payload.wx.rh,
          pressureMb: fallback.weather.pressureMb,
          pressureTrend: fallback.weather.pressureTrend,
          rainRateInHr: fallback.weather.rainRateInHr,
          rainTotalIn: fallback.weather.rainTotalIn,
          source: "vehicle",
          sourceLabel: "VEHICLE (BLE)",
          updatedAt: now,
        }
      : fallback.weather,
    gps: gpsOk
      ? {
          speedMph: payload.gps.spd,
          headingDeg: payload.gps.hdg,
          headingCardinal: cardinalFromDeg(payload.gps.hdg),
          elevationFt: fallback.gps.elevationFt,
          accuracyM: fallback.gps.accuracyM,
          hdop: fallback.gps.hdop,
          satellites: fallback.gps.satellites,
          hasFix: true,
          lat: payload.gps.lat as number,
          lon: payload.gps.lon as number,
          source: "vehicle",
          updatedAt: now,
        }
      : fallback.gps,
    sensors: fallback.sensors,
    power: fallback.power,
    system: fallback.system,
    status: {
      apiLatencyMs: 0,
      dataAgeSeconds: payload.age ?? 0,
      piOnline: payload.health !== "BACKEND_OFFLINE",
      internetOnline: fallback.status.internetOnline,
      mode: "pi",
      updatedAt: now,
      connection: createConnectionStatus({
        ...fallback.status.connection,
        endpoint: "ble",
        connectionState: payload.health === "BACKEND_OFFLINE" ? "DEGRADED" : "CONNECTED",
        lastAttemptAt: now,
        lastConnectedAt: now,
        lastSuccessfulResponseAt: now,
        lastDataAt: now,
        dataAgeMs: Math.max(0, (payload.age ?? 0) * 1000),
        latencyMs: 0,
        failureCount: 0,
        lastErrorCode: payload.health === "BACKEND_OFFLINE" ? "NETWORK_ERROR" : null,
        lastErrorSummary: payload.health === "BACKEND_OFFLINE" ? "BLE connected, Pi backend reports offline." : "",
        retryAt: null,
        provider: "telemetry",
        transport: "ble",
        isConfigured: true,
      }),
    },
    events: fallback.events,
  };
}

function validCoord(lat: number | null, lon: number | null) {
  return isFiniteNumber(lat) && isFiniteNumber(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
}

function unavailableGps(now = Date.now()): GpsData {
  return {
    speedMph: null,
    headingDeg: null,
    headingCardinal: "--",
    elevationFt: null,
    accuracyM: null,
    hdop: null,
    satellites: null,
    hasFix: false,
    lat: 0,
    lon: 0,
    source: "unavailable",
    updatedAt: now,
  };
}

function lastKnownGps(gps: GpsData, now = Date.now()): GpsData {
  if (!gps.hasFix || gps.source === "simulator" || !validCoord(gps.lat, gps.lon)) return unavailableGps(now);
  return {
    ...gps,
    source: "last-known",
    hasFix: true,
  };
}

// updatedAt is deliberately 0 (not "now") for the never-had-data case: ageSeconds()/freshness()
// in quality.ts treat updatedAt<=0 as "no timestamp", which is what lets the UI tell "no data
// ever received" apart from "just went stale."
function unavailableWind(): WindData {
  return {
    speedMph: null,
    gustMph: null,
    directionDeg: null,
    directionCardinal: "--",
    source: "unavailable",
    updatedAt: 0,
  };
}

function lastKnownWind(wind: WindData): WindData {
  const hasData = wind.speedMph !== null || wind.gustMph !== null || wind.directionDeg !== null;
  if (!hasData || wind.source === "simulator" || wind.source === "unavailable") return unavailableWind();
  return { ...wind, source: "last-known" };
}

function unavailableWeather(): WeatherData {
  return {
    tempF: null,
    dewpointF: null,
    humidity: null,
    pressureMb: null,
    pressureTrend: null,
    rainRateInHr: null,
    rainTotalIn: null,
    source: "unavailable",
    sourceLabel: "UNAVAILABLE",
    updatedAt: 0,
  };
}

function lastKnownWeather(weather: WeatherData): WeatherData {
  if (weather.tempF === null || weather.source === "simulator" || weather.source === "unavailable") return unavailableWeather();
  return { ...weather, source: "last-known", sourceLabel: "LAST KNOWN" };
}

function unavailablePower(): PowerData {
  return { mainBatteryV: null, auxBatteryV: null, charging: null, source: "unavailable", updatedAt: 0 };
}

function lastKnownPower(power: PowerData): PowerData {
  const hasData = power.mainBatteryV !== null || power.auxBatteryV !== null || power.charging !== null;
  if (!hasData || power.source === "unavailable" || power.source === "simulator") return unavailablePower();
  return { ...power, source: "last-known" };
}

function unavailableSystem(): SystemData {
  return { cpuPercent: null, ramPercent: null, storagePercent: null, uptimeSeconds: null, source: "unavailable", updatedAt: 0 };
}

function lastKnownSystem(system: SystemData): SystemData {
  const hasData = system.cpuPercent !== null || system.ramPercent !== null || system.storagePercent !== null || system.uptimeSeconds !== null;
  if (!hasData || system.source === "unavailable" || system.source === "simulator") return unavailableSystem();
  return { ...system, source: "last-known" };
}

function endpoint(path: string) {
  const configured = getPiEndpoint();
  const envBase = normalizeEndpointOrEmpty((import.meta.env.VITE_PI_API_BASE as string | undefined) ?? "");
  const base = configured || envBase;
  return `${base}${path}`;
}

function configuredEndpointBase() {
  const configured = getPiEndpoint();
  const envBase = normalizeEndpointOrEmpty((import.meta.env.VITE_PI_API_BASE as string | undefined) ?? "");
  return configured || envBase;
}

export function normalizeSnapshot(raw: unknown, fallback: TelemetrySnapshot, latency: number): TelemetrySnapshot {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const windRaw = (source.wind ?? source.weather ?? source.observation ?? source) as unknown;
  const weatherRaw = (source.weather ?? source.observation ?? source) as unknown;
  const gpsRaw = (source.gps ?? source.navigation ?? source.location ?? source) as unknown;
  const systemRaw = (source.system ?? source.pi ?? source.health ?? source) as unknown;
  const powerRaw = (source.power ?? source.vehiclePower ?? source) as unknown;
  const now = Date.now();

  const windSpeed = readNumberInRange(windRaw, [
    "speedMph",
    "windSpeedMph",
    "wind_speed_mph",
    "wind_mph",
    "speed_mph",
    "speed",
    "windSpeed",
  ], 0, 250);
  const windGust = readNumberInRange(windRaw, ["gustMph", "windGustMph", "wind_gust_mph", "gust_mph", "gust", "windGust"], 0, 300);
  const windDir = readNumberInRange(windRaw, ["directionDeg", "windDirectionDeg", "wind_direction_deg", "direction_degrees", "dir", "direction"], 0, 360);
  const windUpdatedAt = readTimestamp(windRaw, ["updatedAt", "updated_at", "timestamp", "time"], now);
  const hasWindData = windSpeed !== null || windGust !== null || windDir !== null;

  const lat = readNumber(gpsRaw, ["lat", "latitude"]);
  const lon = readNumber(gpsRaw, ["lon", "lng", "longitude"]);
  const gpsUpdatedAt = readTimestamp(gpsRaw, ["updatedAt", "updated_at", "timestamp", "time"], 0);
  const gpsAge = now - gpsUpdatedAt;
  const vehicleGpsValid = validCoord(lat, lon) && gpsAge <= GPS_MAX_AGE_MS && readString(gpsRaw, ["fix", "fixType"]) !== "none";
  const gps: GpsData = vehicleGpsValid
    ? {
        speedMph: readNumberInRange(gpsRaw, ["speedMph", "speed_mph", "groundSpeedMph"], 0, 500),
        headingDeg: readNumberInRange(gpsRaw, ["headingDeg", "heading_deg", "courseDeg", "trackDeg"], 0, 360),
        headingCardinal: cardinalFromDeg(readNumberInRange(gpsRaw, ["headingDeg", "heading_deg", "courseDeg", "trackDeg"], 0, 360)),
        elevationFt: readNumberInRange(gpsRaw, ["elevationFt", "elevation_ft", "altitudeFt", "altitude_ft"], -1500, 60000),
        accuracyM: readNumberInRange(gpsRaw, ["accuracyM", "accuracy_m", "eph"], 0, 100000),
        hdop: readNumberInRange(gpsRaw, ["hdop"], 0, 100),
        satellites: readNumberInRange(gpsRaw, ["satellites", "sats", "numSatellites"], 0, 100),
        hasFix: true,
        lat: lat!,
        lon: lon!,
        source: readString(gpsRaw, ["source"]) === "esp" ? "esp" : "vehicle",
        updatedAt: gpsUpdatedAt,
    }
    : fallback.gps;
  const weatherTemp = readNumberInRange(weatherRaw, ["tempF", "temperatureF", "temperature_f", "temp_f"], -100, 160);
  const weatherDewpoint = readNumberInRange(weatherRaw, ["dewpointF", "dewPointF", "dewpoint_f", "dew_point_f"], -120, 100);
  const weatherHumidity = readNumberInRange(weatherRaw, ["humidity", "relativeHumidity", "relative_humidity"], 0, 100);
  const weatherPressure = readNumberInRange(weatherRaw, ["pressureMb", "pressure_mb", "barometerMb", "barometricPressureMb"], 800, 1100);
  const weatherRainRate = readNumberInRange(weatherRaw, ["rainRateInHr", "rain_rate_in_hr", "rainRate"], 0, 50);
  const weatherRainTotal = readNumberInRange(weatherRaw, ["rainTotalIn", "rain_total_in", "rainAccumulationIn"], 0, 500);
  const pressureTrendRaw = readString(weatherRaw, ["pressureTrend", "pressure_trend"]);
  const weatherPressureTrend = pressureTrendRaw === "rising" || pressureTrendRaw === "steady" || pressureTrendRaw === "falling" ? pressureTrendRaw : null;
  const hasWeatherData =
    weatherTemp !== null ||
    weatherDewpoint !== null ||
    weatherHumidity !== null ||
    weatherPressure !== null ||
    weatherPressureTrend !== null ||
    weatherRainRate !== null ||
    weatherRainTotal !== null;
  const powerMain = readNumberInRange(powerRaw, ["mainBatteryV", "main_battery_v", "batteryV"], 0, 60);
  const powerAux = readNumberInRange(powerRaw, ["auxBatteryV", "aux_battery_v"], 0, 60);
  const chargingRaw = powerRaw && typeof powerRaw === "object" ? (powerRaw as Record<string, unknown>).charging : undefined;
  const charging = typeof chargingRaw === "boolean" ? chargingRaw : null;
  const hasPowerData = powerMain !== null || powerAux !== null || charging !== null;
  const cpuPercent = readNumberInRange(systemRaw, ["cpuPercent", "cpu_percent", "cpu"], 0, 100);
  const ramPercent = readNumberInRange(systemRaw, ["ramPercent", "ram_percent", "memoryPercent"], 0, 100);
  const storagePercent = readNumberInRange(systemRaw, ["storagePercent", "storage_percent", "diskPercent"], 0, 100);
  const uptimeSeconds = readNumberInRange(systemRaw, ["uptimeSeconds", "uptime_seconds", "uptime"], 0, 31_536_000);
  const hasSystemData = cpuPercent !== null || ramPercent !== null || storagePercent !== null || uptimeSeconds !== null;

  return {
    wind: hasWindData
      ? {
          speedMph: windSpeed,
          gustMph: windGust,
          directionDeg: windDir,
          directionCardinal: cardinalFromDeg(windDir),
          source: "vehicle",
          updatedAt: windUpdatedAt,
        }
      : fallback.wind,
    weather: hasWeatherData
      ? {
          tempF: weatherTemp,
          dewpointF: weatherDewpoint,
          humidity: weatherHumidity,
          pressureMb: weatherPressure,
          pressureTrend: weatherPressureTrend,
          rainRateInHr: weatherRainRate,
          rainTotalIn: weatherRainTotal,
          source: "vehicle",
          sourceLabel: "VEHICLE",
          updatedAt: readTimestamp(weatherRaw, ["updatedAt", "updated_at", "timestamp", "time"], now),
        }
      : fallback.weather,
    gps,
    sensors: readSensors(source, fallback.sensors),
    power: hasPowerData
      ? {
          mainBatteryV: powerMain,
          auxBatteryV: powerAux,
          charging,
          source: "vehicle",
          updatedAt: readTimestamp(powerRaw, ["updatedAt", "updated_at", "timestamp", "time"], now),
        }
      : fallback.power,
    system: hasSystemData
      ? {
          cpuPercent,
          ramPercent,
          storagePercent,
          uptimeSeconds,
          source: "vehicle",
          updatedAt: readTimestamp(systemRaw, ["updatedAt", "updated_at", "timestamp", "time"], now),
        }
      : fallback.system,
    status: {
      apiLatencyMs: latency,
      dataAgeSeconds: 0,
      piOnline: true,
      internetOnline: fallback.status.internetOnline,
      mode: "pi",
      updatedAt: now,
      connection: createConnectionStatus({
        ...fallback.status.connection,
        endpoint: configuredEndpointBase(),
        connectionState: "CONNECTED",
        lastAttemptAt: now,
        lastConnectedAt: now,
        lastSuccessfulResponseAt: now,
        lastDataAt: now,
        dataAgeMs: 0,
        latencyMs: latency,
        failureCount: 0,
        lastErrorCode: null,
        lastErrorSummary: "",
        retryAt: null,
        provider: "telemetry",
        transport: inferConnectionTransport(configuredEndpointBase()),
        isConfigured: Boolean(configuredEndpointBase()),
      }),
    },
    events: readEvents(source, fallback.events),
  };
}

export class HybridTelemetryProvider implements TelemetryProvider {
  private fallback = new SimulatorProvider();
  private snapshot = this.offlineSnapshot(this.fallback.getLatest(), "App started in standalone device mode");
  private subscribers: Set<(s: TelemetrySnapshot) => void> = new Set();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private tabletLocation: TabletLocationInput | null = null;
  private paused = false;
  private failureCount = 0;
  private nextPollAt = 0;
  private lastBleAt = 0;
  private inFlightPoll: AbortController | null = null;

  constructor() {
    void this.restoreLastSnapshot();
    void loadPiEndpoint();
    subscribePiEndpoint(() => {
      this.failureCount = 0;
      this.nextPollAt = 0;
      void this.poll();
    });
    // Manual owner switch (Settings -> Pi Connection) -- lets BLE scanning + HTTP polling be turned
    // off entirely rather than retrying forever when there's genuinely no Pi/ESP on this vehicle
    // yet. Fires immediately with the current in-memory value on subscribe, so this also replaces
    // the old unconditional bleTelemetryClient.start() call below.
    const applyTelemetryLinkSetting = (enabled: boolean) => {
      if (enabled) {
        this.failureCount = 0;
        this.nextPollAt = 0;
        bleTelemetryClient.start();
        void this.poll();
      } else {
        this.inFlightPoll?.abort();
        this.inFlightPoll = null;
        bleTelemetryClient.stop();
        this.publish(this.applyTabletGps(this.offlineSnapshot(this.snapshot, "Pi/ESP link turned off in Settings")));
      }
    };
    void loadTelemetryLinkEnabled().then((enabled) => {
      applyTelemetryLinkSetting(enabled);
      subscribeTelemetryLinkEnabled(applyTelemetryLinkSetting);
    });
    // BLE is the primary link to the Pi (no WiFi/Starlink dependency); HTTP polling below stays as
    // a fallback for whenever BLE isn't connected. Whichever is currently fresh wins -- see the
    // guard at the top of poll().
    bleTelemetryClient.subscribe((payload) => {
      if (!payload || !getTelemetryLinkEnabled()) return;
      const now = Date.now();
      this.lastBleAt = now;
      this.publish(this.applyTabletGps(normalizeBleSnapshot(payload, this.snapshot, now)));
    });
    if (SIMULATOR_ALLOWED) {
      this.fallback.subscribe((snapshot) => {
        if (!this.snapshot.status.piOnline) {
          this.publish(
            this.applyTabletGps({
              ...snapshot,
              weather: { ...snapshot.weather, sourceLabel: "SIMULATOR", source: "simulator" },
              wind: { ...snapshot.wind, source: "simulator" },
              status: {
                ...snapshot.status,
                piOnline: false,
                mode: "simulator",
                updatedAt: Date.now(),
                connection: createConnectionStatus({
                  ...snapshot.status.connection,
                  connectionState: "DEGRADED",
                  lastErrorSummary: "Simulator fallback active; Pi/Core telemetry is not live.",
                }),
              },
            }),
          );
        }
      });
    }
    this.pollTimer = setInterval(() => void this.poll(), POLL_MS);
    if (import.meta.env.DEV && typeof window !== "undefined") {
      (window as typeof window & { __CODEBLACK_TEST_SET_TELEMETRY__?: (snapshot: TelemetrySnapshot) => void }).__CODEBLACK_TEST_SET_TELEMETRY__ = (snapshot) => {
        this.publish(snapshot);
      };
    }
    void this.poll();
  }

  setTabletLocation(location: TabletLocationInput | null) {
    this.tabletLocation = location && validCoord(location.lat, location.lon) ? location : null;
    this.publish(this.applyTabletGps(this.snapshot));
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (paused) {
      bleTelemetryClient.pause();
    } else {
      this.failureCount = 0;
      this.nextPollAt = 0;
      void this.poll();
      bleTelemetryClient.resume();
    }
  }

  private applyTabletGps(snapshot: TelemetrySnapshot): TelemetrySnapshot {
    const vehicleAge = Date.now() - snapshot.gps.updatedAt;
    const vehicleValid =
      (snapshot.gps.source === "vehicle" || snapshot.gps.source === "esp") &&
      snapshot.gps.hasFix &&
      validCoord(snapshot.gps.lat, snapshot.gps.lon) &&
      vehicleAge < GPS_MAX_AGE_MS;
    if (vehicleValid || !this.tabletLocation) return snapshot;
    const tab = this.tabletLocation;
    if (!validCoord(tab.lat, tab.lon)) return snapshot;
    return {
      ...snapshot,
      gps: {
        ...snapshot.gps,
        lat: tab.lat,
        lon: tab.lon,
        speedMph: tab.speedMph,
        headingDeg: tab.headingDeg,
        headingCardinal: cardinalFromDeg(tab.headingDeg),
        elevationFt: tab.elevationFt,
        accuracyM: tab.accuracyM,
        hdop: null,
        satellites: null,
        hasFix: true,
        source: "tablet",
        updatedAt: tab.updatedAt,
      },
      status: { ...snapshot.status, mode: snapshot.status.piOnline ? "pi" : "tablet" },
    };
  }

  private publish(snapshot: TelemetrySnapshot) {
    this.snapshot = snapshot;
    this.subscribers.forEach((callback) => callback(snapshot));
  }

  private offlineSnapshot(snapshot: TelemetrySnapshot, message = "Pi API offline"): TelemetrySnapshot {
    const now = Date.now();
    const existingEvents = snapshot.events.filter((event) => !/sensor|sync|uptime|online/i.test(event.message));
    const lastSameEvent = existingEvents.find((event) => event.message === message);
    const shouldAddEvent = !lastSameEvent || now - lastSameEvent.timestamp > 60_000;
    return {
      ...snapshot,
      gps: lastKnownGps(snapshot.gps, now),
      wind: lastKnownWind(snapshot.wind),
      weather: lastKnownWeather(snapshot.weather),
      sensors: snapshot.sensors.map((sensor) => ({ ...sensor, online: false, packetRateHz: 0 })),
      power: lastKnownPower(snapshot.power),
      system: lastKnownSystem(snapshot.system),
      status: {
        ...snapshot.status,
        apiLatencyMs: 0,
        dataAgeSeconds: Math.max(0, Math.round((now - snapshot.status.updatedAt) / 1000)),
        piOnline: false,
        mode: "tablet",
        updatedAt: now,
        connection: this.offlineConnectionStatus(snapshot.status.connection, message, now),
      },
      events: [
        ...(shouldAddEvent ? [{ id: `evt-${now}-${Math.random().toString(36).slice(2, 8)}`, timestamp: now, level: "warn" as const, message }] : []),
        ...existingEvents,
      ].slice(0, 8),
    };
  }

  private offlineConnectionStatus(previous: ConnectionStatus, message: string, now: number): ConnectionStatus {
    const endpointBase = configuredEndpointBase();
    const isConfigured = Boolean(endpointBase);
    const disabled = !getTelemetryLinkEnabled();
    const noEndpoint = !isConfigured && !disabled;
    const dataAgeMs = previous.lastDataAt ? Math.max(0, now - previous.lastDataAt) : null;
    const freshness = dataFreshnessState(previous.lastDataAt, now, 30_000, 180_000);
    const state = disabled ? "DISCONNECTED" : noEndpoint ? "NOT_CONFIGURED" : freshness === "STALE" ? "STALE" : "DISCONNECTED";
    return createConnectionStatus({
      ...previous,
      endpoint: endpointBase,
      connectionState: state,
      dataAgeMs,
      failureCount: noEndpoint || disabled ? 0 : this.failureCount,
      lastErrorCode: noEndpoint ? "NOT_CONFIGURED" : disabled ? null : previous.lastErrorCode ?? "NETWORK_ERROR",
      lastErrorSummary: noEndpoint ? "Pi endpoint is not configured." : disabled ? "Pi/ESP link is turned off." : message,
      retryAt: this.nextPollAt || null,
      provider: "telemetry",
      transport: inferConnectionTransport(endpointBase),
      isConfigured,
    });
  }

  private async restoreLastSnapshot() {
    const saved = await Preferences.get({ key: LAST_SNAPSHOT_KEY });
    if (!saved.value) return;
    try {
      const parsed = JSON.parse(saved.value) as TelemetrySnapshot;
      this.publish(this.offlineSnapshot(parsed, "Loaded cached telemetry metadata"));
    } catch {
      // Ignore malformed persisted snapshots.
    }
  }

  private persistLastSnapshot(snapshot: TelemetrySnapshot) {
    void Preferences.set({ key: LAST_SNAPSHOT_KEY, value: JSON.stringify(snapshot) });
  }

  private async poll() {
    if (this.paused) return;
    if (!getTelemetryLinkEnabled()) return;
    const now = Date.now();
    if (now - this.lastBleAt < BLE_FRESH_WINDOW_MS) return;
    if (now < this.nextPollAt) return;
    if (this.inFlightPoll) return;
    if (!getPiEndpoint() && !import.meta.env.VITE_PI_API_BASE) {
      this.nextPollAt = now + 30_000;
      this.publish(this.applyTabletGps(this.offlineSnapshot(this.snapshot, "Pi endpoint not configured")));
      return;
    }
    const controller = new AbortController();
    this.inFlightPoll = controller;
    const start = performance.now();
    try {
      const response = await fetchWithTimeout(endpoint("/api/latest"), 1500, { signal: controller.signal });
      if (!response.ok) {
        const classified = classifyHttpStatus(response.status, response.statusText);
        this.failureCount++;
        this.nextPollAt = Date.now() + nextBackoffDelayMs(this.failureCount, { baseMs: 1_500, maxMs: 45_000 });
        this.snapshot = {
          ...this.snapshot,
          status: {
            ...this.snapshot.status,
            connection: createConnectionStatus({
              ...this.snapshot.status.connection,
              endpoint: configuredEndpointBase(),
              connectionState: classified.connectionState,
              lastAttemptAt: now,
              failureCount: this.failureCount,
              lastErrorCode: classified.lastErrorCode,
              lastErrorSummary: classified.lastErrorSummary,
              retryAt: this.nextPollAt,
              provider: "telemetry",
              transport: inferConnectionTransport(configuredEndpointBase()),
              isConfigured: Boolean(configuredEndpointBase()),
            }),
          },
        };
        this.publish(this.applyTabletGps(this.offlineSnapshot(this.snapshot, classified.lastErrorSummary)));
        return;
      }
      const data: unknown = await response.json();
      const latency = Math.round(performance.now() - start);
      this.failureCount = 0;
      this.nextPollAt = 0;
      const normalized = this.applyTabletGps(normalizeSnapshot(data, this.snapshot, latency));
      this.publish(normalized);
      this.persistLastSnapshot(normalized);
    } catch (error) {
      if (controller.signal.aborted) return;
      this.failureCount++;
      const classified = classifyFetchError(error);
      this.nextPollAt = Date.now() + nextBackoffDelayMs(this.failureCount, { baseMs: 1_500, maxMs: 45_000 });
      this.snapshot = {
        ...this.snapshot,
        status: {
          ...this.snapshot.status,
          connection: createConnectionStatus({
            ...this.snapshot.status.connection,
            endpoint: configuredEndpointBase(),
            connectionState: classified.connectionState,
            lastAttemptAt: now,
            failureCount: this.failureCount,
            lastErrorCode: classified.lastErrorCode,
            lastErrorSummary: classified.lastErrorSummary,
            retryAt: this.nextPollAt,
            provider: "telemetry",
            transport: inferConnectionTransport(configuredEndpointBase()),
            isConfigured: Boolean(configuredEndpointBase()),
          }),
        },
      };
      this.publish(this.applyTabletGps(this.offlineSnapshot(this.snapshot, classified.lastErrorSummary || "Pi API offline")));
    } finally {
      if (this.inFlightPoll === controller) this.inFlightPoll = null;
    }
  }

  subscribe(callback: (snapshot: TelemetrySnapshot) => void) {
    this.subscribers.add(callback);
    callback(this.snapshot);
    return () => this.subscribers.delete(callback);
  }

  getLatest() {
    return this.snapshot;
  }

  disconnect() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.fallback.disconnect();
    bleTelemetryClient.stop();
    this.subscribers.clear();
  }
}
