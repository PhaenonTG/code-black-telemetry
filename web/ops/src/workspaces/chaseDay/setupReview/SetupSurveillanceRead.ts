import { fetchForecast } from "../../../core/client";
import type { WeightedSynthesis } from "../../setupReviewModel";
type SetupRow = { setup_id: string; day: number; risk_label: string; revision: number; valid_until: string };
export type SetupIndex = { status: string; checked_at?: string; last_source_check_at?: string; items: SetupRow[] };
export type SetupDetail = SetupRow & { weighted_synthesis?: WeightedSynthesis | null; unavailable?: boolean };
export async function surveillanceDetails(config: Parameters<typeof fetchForecast>[0], rows: SetupRow[], signal: AbortSignal): Promise<SetupDetail[]> {
  const results = await Promise.allSettled(rows.map(row => fetchForecast<SetupDetail>(config, `chase-setup?setup_id=${encodeURIComponent(row.setup_id)}`, signal)));
  return results.map((result, i) => result.status === "fulfilled" ? result.value : { ...rows[i], unavailable: true });
}
