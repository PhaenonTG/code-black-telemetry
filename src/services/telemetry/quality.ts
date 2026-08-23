import type { EventEntry, FreshnessState, SensorHealth } from "./types";

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function readNumber(source: unknown, keys: string[]): number | null {
  if (!source || typeof source !== "object") return null;
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (isFiniteNumber(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

export function readNumberInRange(source: unknown, keys: string[], min: number, max: number): number | null {
  const value = readNumber(source, keys);
  if (!isFiniteNumber(value) || value < min || value > max) return null;
  return value;
}

export function readString(source: unknown, keys: string[]): string | null {
  if (!source || typeof source !== "object") return null;
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

export function readTimestamp(source: unknown, keys: string[], fallback = Date.now()): number {
  const raw = readString(source, keys);
  if (raw) {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  const numeric = readNumber(source, keys);
  if (numeric !== null) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  return fallback;
}

export function cardinalFromDeg(deg: number | null): string {
  if (!isFiniteNumber(deg)) return "--";
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

export function valueText(value: number | null | undefined, digits = 0, fallback = "--"): string {
  if (!isFiniteNumber(value)) return fallback;
  return value.toFixed(digits);
}

export function mbToInHg(mb: number | null | undefined): number | null {
  if (!isFiniteNumber(mb)) return null;
  return mb * 0.0295299830714;
}

export function ageSeconds(updatedAt: number | null | undefined, now = Date.now()): number | null {
  if (!isFiniteNumber(updatedAt) || updatedAt <= 0) return null;
  return Math.max(0, Math.round((now - updatedAt) / 1000));
}

export function freshness(updatedAt: number | null | undefined, options?: { live?: number; recent?: number; stale?: number }): FreshnessState {
  const age = ageSeconds(updatedAt);
  if (age === null) return "OFFLINE";
  const live = options?.live ?? 8;
  const recent = options?.recent ?? 60;
  const stale = options?.stale ?? 300;
  if (age <= live) return "LIVE";
  if (age <= recent) return "RECENT";
  if (age <= stale) return "STALE";
  return "OFFLINE";
}

export function ageLabel(updatedAt: number | null | undefined): string {
  const age = ageSeconds(updatedAt);
  if (age === null) return "NO TIMESTAMP";
  if (age < 5) return "LIVE";
  if (age < 60) return `${age} SEC AGO`;
  const minutes = Math.round(age / 60);
  if (minutes < 90) return `${minutes} MIN AGO`;
  return `${Math.round(minutes / 60)} HR AGO`;
}

export function compactAge(updatedAt: number | null | undefined): string {
  return ageLabel(updatedAt)
    .replace(" AGO", "")
    .replace(" MIN", "M")
    .replace(" SEC", "S")
    .replace(" HR", "H")
    .replace(" HOUR", "H");
}

function readArray(source: unknown, keys: string[]): unknown[] | null {
  if (!source || typeof source !== "object") return null;
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return null;
}

export function readSensors(raw: unknown, fallback: SensorHealth[]): SensorHealth[] {
  const entries = readArray(raw, ["sensors", "esp", "espSensors", "devices", "nodes"]);
  if (!entries) return fallback;
  return entries.map((entry, index) => {
    const id = readString(entry, ["id", "sensorId", "name", "label"]) ?? `sensor-${index}`;
    const label = readString(entry, ["label", "name", "id"]) ?? id;
    const lastPacketAt = readTimestamp(entry, ["lastPacketAt", "last_packet_at", "updatedAt", "updated_at", "timestamp"], 0);
    const packetRateHz = readNumber(entry, ["packetRateHz", "packet_rate_hz", "rateHz", "hz"]) ?? 0;
    const explicitOnline = entry && typeof entry === "object" ? (entry as Record<string, unknown>).online ?? (entry as Record<string, unknown>).connected : undefined;
    const online = typeof explicitOnline === "boolean" ? explicitOnline : lastPacketAt > 0;
    return { id, label, online, lastPacketAt, packetRateHz };
  });
}

const EVENT_LEVELS = new Set(["info", "warn", "error"]);

export function readEvents(raw: unknown, fallback: EventEntry[]): EventEntry[] {
  const entries = readArray(raw, ["events", "log", "eventLog"]);
  if (!entries) return fallback;
  return entries.map((entry, index) => {
    const id = readString(entry, ["id", "eventId"]) ?? `evt-${index}-${Date.now()}`;
    const timestamp = readTimestamp(entry, ["timestamp", "updatedAt", "updated_at", "time"], Date.now());
    const message = readString(entry, ["message", "msg", "text"]) ?? "";
    const levelRaw = readString(entry, ["level", "severity"])?.toLowerCase();
    const level = (levelRaw && EVENT_LEVELS.has(levelRaw) ? levelRaw : "info") as EventEntry["level"];
    return { id, timestamp, message, level };
  });
}

export function distanceMiles(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}
