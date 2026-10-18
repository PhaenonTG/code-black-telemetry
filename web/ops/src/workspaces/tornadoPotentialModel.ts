export type PotentialFeature = { type: "Feature"; geometry: { type: "Polygon"; coordinates: number[][][] };
  properties: { tier: number; label: string; storm_supported: boolean | null; index_mean: number; index_max: number; native_land_points: number } }
export type PotentialPayload = {
  schema: string; status: string; frame_id?: string; run_time?: string; valid_time?: string; generated_at?: string;
  type: "FeatureCollection"; features: PotentialFeature[]; notice: string;
  frames: Array<{ frame_id: string; valid_time: string; run_time: string; forecast_hour: number }>;
  coverage?: { native_land_points_evaluated: number; display_cells_shaded: number; resolution_degrees: number };
  automatic_aegis?: { status: string; checked_at?: string; setups: Array<{ setup_id: string; revision: number; status: string; summary?: string; reason?: string; completed_at?: string; previous_summary?: string; previous_revision?: number }> };
}
export function parsePotential(value: unknown): PotentialPayload {
  const data = value as PotentialPayload
  if (!data || data.schema !== "codeblack.tornado-potential.v1" || data.type !== "FeatureCollection" ||
      !Array.isArray(data.features) || !Array.isArray(data.frames) || data.features.length > 25000 ||
      !data.frames.every(frame => /^\d{10}-f\d{2}$/.test(frame.frame_id) && Number.isFinite(Date.parse(frame.valid_time))) ||
      !data.features.every(feature => feature.type === "Feature" && feature.geometry?.type === "Polygon" &&
        Array.isArray(feature.geometry.coordinates) && feature.geometry.coordinates.length === 1 &&
        feature.geometry.coordinates[0].length >= 4 && feature.geometry.coordinates[0].every(point =>
          Array.isArray(point) && point.length === 2 && Number.isFinite(point[0]) && Math.abs(point[0]) <= 180 &&
          Number.isFinite(point[1]) && Math.abs(point[1]) <= 90) &&
        [1, 2, 3].includes(feature.properties?.tier) && Number.isFinite(feature.properties.index_mean))) {
    throw new Error("Tornado potential data is incomplete or malformed.")
  }
  return data
}
