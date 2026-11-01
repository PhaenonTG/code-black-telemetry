import type { TrackPoint } from "./types";

export function positionAt(points: { latitude: number; longitude: number; valid_time: string | null; wind_mph?: number | null }[], time: number): TrackPoint | null {
  const rows = points.filter(p => p.valid_time && Number.isFinite(Date.parse(p.valid_time))).sort((a,b) => Date.parse(a.valid_time!) - Date.parse(b.valid_time!));
  const exact = rows.find(p => Date.parse(p.valid_time!) === time);
  if (exact) return { ...exact, hour: 0, wind_mph: exact.wind_mph ?? null };
  const i = rows.findIndex(p => Date.parse(p.valid_time!) > time);
  if (i <= 0) return null;
  const a = rows[i-1], b = rows[i], start = Date.parse(a.valid_time!), end = Date.parse(b.valid_time!);
  if (end - start > 24 * 3600_000) return null;
  const f = (time - start) / (end - start);
  return { latitude: a.latitude + (b.latitude-a.latitude)*f, longitude: a.longitude+(b.longitude-a.longitude)*f,
    valid_time: new Date(time).toISOString(), hour: 0, wind_mph: a.wind_mph == null || b.wind_mph == null ? null : Math.round(a.wind_mph+(b.wind_mph-a.wind_mph)*f) };
}

export function ageLabel(value: string | null | undefined, now = Date.now()) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Time unavailable";
  const min = Math.max(0, Math.floor((now-Date.parse(value))/60_000));
  return min < 1 ? "Just updated" : min < 60 ? `${min} min old` : `${Math.floor(min/60)}h ${min%60}m old`;
}

export function forecastBase(data: { storm: { last_update: string | null } }) {
  const base = Date.parse(data.storm.last_update ?? "");
  return Math.ceil((Number.isFinite(base) ? base : Date.now()) / 3600_000) * 3600_000;
}
