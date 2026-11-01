export type StormPoint = { latitude: number; longitude: number; valid_time: string | null;
  hour: number | null; wind_mph: number | null; pressure_mb: number | null };
export type StormReview = { status: "ready" | "pending" | "unavailable" | "stale" | "withheld";
  model?: string | null; reviewed_at?: string | null; basis_nhc_updated_at?: string | null;
  confidence?: "low" | "moderate" | "high"; summary?: string | null;
  track_assessment?: string | null; intensity_assessment?: string | null;
  changes?: string[]; uncertainties?: string[]; next_check?: string[];
  evidence?: { source: string; finding: string | null }[] };
export type StormSystem = {
  status: "active" | "historical" | "pending" | "unavailable"; freshness?: "current" | "stale";
  storm_id?: string; name?: string | null; classification?: string | null; basin?: string | null;
  checked_at?: string | null; nhc_updated_at?: string | null; wind_kt?: number | null; pressure_mb?: number | null;
  current_center?: { latitude: number | null; longitude: number | null };
  track?: StormPoint[]; track_issued_at?: string | null; observed_track?: StormPoint[]; reported_centers?: StormPoint[];
  guidance?: { status: string; latest_cycle: string | null;
    models: { id: string; name: string | null; cycle: string | null; points: StormPoint[] }[] };
  projection?: { status: string; method: string | null; cycle: string | null; member_ids: string[]; points: StormPoint[] };
  analysis?: StormReview;
  prior_reviews?: StormReview[];
  sources?: { advisory: string | null; discussion: string | null; status: string | null; track: string | null };
};

export const validStormId = (id: string) => /^(?:al|ep|cp)\d{6}$/.test(id);
export const basinName = (value: string | null | undefined) => ({ atlantic: "Atlantic", eastern_pacific: "East Pacific", central_pacific: "Central Pacific" } as Record<string, string>)[value ?? ""] ?? "NHC basin";
export const stormClass = (value: string | null | undefined) => ({ HU: "Hurricane", TS: "Tropical storm", TD: "Tropical depression", SS: "Subtropical storm", SD: "Subtropical depression", PTC: "Post-tropical cyclone", PT: "Post-tropical cyclone", EX: "Extratropical cyclone" } as Record<string, string>)[value ?? ""] ?? "Tropical cyclone";
export const position = (latitude: number | null | undefined, longitude: number | null | undefined) => latitude == null || longitude == null ? "Unavailable" :
  `${Math.abs(latitude).toFixed(1)}°${latitude < 0 ? "S" : "N"} · ${Math.abs(longitude).toFixed(1)}°${longitude < 0 ? "W" : "E"}`;
export const windMph = (knots: number | null | undefined) => knots == null ? null : Math.round(knots * 1.15078);
