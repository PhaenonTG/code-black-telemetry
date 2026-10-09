export type TrackPoint = { latitude: number; longitude: number; hour: number; valid_time: string | null; wind_mph: number | null };
export type ProjectionPoint = { latitude: number; longitude: number; hour: number; valid_time: string; spread_miles: number; members: number };
export type Model = { id: string; name: string; cycle: string | null; points: TrackPoint[]; shift_48h_miles: number | null };
export type PublicHurricane = {
  status: string; checked_at: string | null; freshness: string | null;
  storm: { id: string | null; name: string | null; classification: string | null; max_wind_mph: number | null; pressure_mb: number | null;
    center: { latitude: number | null; longitude: number | null }; movement_degrees: number | null; movement_mph: number | null; last_update: string | null };
  official: { track: TrackPoint[]; cone: number[][]; cone_status: string | null; advisory_url: string | null; discussion_url: string | null };
  projection: { status: string; points: ProjectionPoint[]; cycle?: string; method: string; member_ids?: string[] };
  guidance: { status: string | null; latest_cycle: string | null; models: Model[]; spread_48h_miles: number | null; wind_48h_mph_range: number[] | null };
  observed: { track: { latitude: number; longitude: number; valid_time: string | null; wind_mph: number | null; pressure_mb: number | null }[];
    trend: { period_hours: number | null; wind_change_mph: number | null; pressure_change_mb: number | null } };
  regional_alerts: { event: string | null; headline: string | null; severity: string | null; expires: string | null; url: string | null }[];
  regional_alerts_status: string | null; disclosure: string;
};

export const displayTime = (value: string | null | undefined) => {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Not available" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date);
};

export const signed = (value: number | null | undefined, unit: string) => value == null ? "—" : `${value > 0 ? "+" : ""}${value} ${unit}`;
