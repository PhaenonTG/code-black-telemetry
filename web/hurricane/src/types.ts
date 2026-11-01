export type TrackPoint = { latitude: number; longitude: number; hour: number; valid_time: string | null; wind_mph: number | null };
export type ProjectionPoint = { latitude: number; longitude: number; hour: number; valid_time: string; spread_miles: number; members: number };
export type Model = { id: string; name: string; cycle: string | null; points: TrackPoint[]; shift_48h_miles: number | null };
export type PublicHurricane = {
  status: string; checked_at: string | null; freshness: string | null;
  verification?: { status: string; samples: {source:string;issued_at:string;valid_time:string;lead_hours:number;center_error_miles:number}[]; scorecard?: {lead:string;matched_count:number;code_black_mean_miles:number|null;nhc_mean_miles:number|null}[]; history: {cycle:string;checked_at:string;points:TrackPoint[]}[] };
  storm: { id: string | null; name: string | null; classification: string | null; max_wind_mph: number | null; pressure_mb: number | null;
    center: { latitude: number | null; longitude: number | null }; movement_degrees: number | null; movement_mph: number | null; last_update: string | null };
  official: { track: TrackPoint[]; issued_at?: string | null; landfall?: { status: "confirmed"; at: string; observed_at: string | null; location: string; source: string; wind_mph: number | null; pressure_mb: number | null } | null; cone: number[][]; cone_status: string | null; advisory_url: string | null; discussion_url: string | null };
  projection: { status: string; points: ProjectionPoint[]; cycle?: string; cycle_lag_hours?: number | null; method: string; member_ids?: string[]; anchor_at?: string | null; anchor_source?: string | null };
  guidance: { status: string | null; latest_cycle: string | null; models: Model[]; spread_48h_miles: number | null; wind_48h_mph_range: number[] | null };
  observed: { track: { latitude: number; longitude: number; valid_time: string | null; wind_mph: number | null; pressure_mb: number | null }[];
    trend: { period_hours: number | null; wind_change_mph: number | null; pressure_change_mb: number | null } };
  observations?: {
    recon: { status: string; observed_at: string | null; latitude: number | null; longitude: number | null;
      pressure_mb: number | null; eye_characteristic: string | null; eye_diameter_nm: number | null;
      max_flight_wind_kt: number | null; source: string };
    aircraft_fixes: { observed_at: string; latitude: number; longitude: number; pressure_mb: number | null }[];
    maritime: { station: string; status: string; observed_at: string | null; wind_m_s: number | null;
      gust_m_s: number | null; pressure_hpa: number | null; pressure_change_3h_hpa: number | null; source: string }[];
  };
  changes: { first_run: boolean; previous_checked_at: string | null; advisory_changed: boolean; wind_change_mph: number | null; pressure_change_mb: number | null;
    new_alerts: string[]; cleared_alerts: string[]; model_cycle_changes: string[]; new_report_count: number };
  monitoring: { radar_analysis: string; radar_observed_at?: string | null; source_check_minutes: number; ai_mode: string; model_tracks: number; paid_phase?: string | null; paid_model?: string | null };
  regional_alerts: { event: string | null; headline: string | null; severity: string | null; expires: string | null; url: string | null }[];
  regional_tornado_alerts?: { event: string | null; headline: string | null; expires: string | null; url: string | null; areas: string | null; geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown } | null }[];
  regional_alerts_status: string | null; disclosure: string;
  ai?: { status: "ready" | "stale" | "withheld" | "unavailable"; analyzed_at: string | null; reviewed_at: string | null;
    review_model: string | null; summary: string | null; next_hour_outlook?: string | null;
    landfall?: { source: string; center_time: string; window_start: string | null; window_end: string | null;
      latitude: number; longitude: number; region: string; nearest_city: string | null } | null;
    supporting_factors: string[]; uncertainties: string[]; recommended_attention: string[];
    decision_record?: { track_assessment: string | null; intensity_assessment: string | null;
      confidence: string; confidence_reason: string | null;
      alternate_landfall: { source: string; center_time: string; region: string; nearest_city: string | null } | null;
      hazards: { wind: string | null; coastal_water: string | null; flooding: string | null; tornado: string | null };
      changes: string[]; next_hour_triggers: string[]; missing_sources: string[];
      data_requests: { source: string; question: string; why: string; priority: string }[] } };
};

export const displayTime = (value: string | null | undefined) => {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Not available" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date);
};

export const signed = (value: number | null | undefined, unit: string) => value == null ? "—" : `${value > 0 ? "+" : ""}${value} ${unit}`;
