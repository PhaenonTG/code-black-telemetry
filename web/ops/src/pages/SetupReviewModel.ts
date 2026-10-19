import { fetchForecast } from "../core/client"
import { requestDeadline } from "../core/requestDeadline"
import { selectBriefing, type Briefing } from "../workspaces/chaseDay/chaseDayModel"
import type { PotentialPayload } from "../workspaces/tornadoPotentialModel"
export const SETUP_TABS = ["today", "outlook", "potential", "drafts", "briefings", "surveillance"] as const
export type SetupTab = typeof SETUP_TABS[number]
export function analysisDestination(path: string, search = ""): string {
  const parts = path.split("/").filter(Boolean).slice(1)
  if (parts[0] === "setup") parts[0] = "drafts"
  if (parts[0] === "horizons") parts[0] = "outlook"
  if (parts.length === 0 && new URLSearchParams(search).get("mode") === "today") return `/setup-review/today${search}`
  return `/setup-review${parts.length ? `/${parts.join("/")}` : ""}${search}`
}
export async function setupLanding(config: Parameters<typeof fetchForecast>[0], signal: AbortSignal): Promise<SetupTab> {
  try {
    return await requestDeadline(async requestSignal => {
      const index = await fetchForecast<{ items: Array<{ setup_id: string; day?: number }> }>(config, "chase-setups", requestSignal)
      const records = await Promise.allSettled(index.items.filter(row => row.day === 1).map(row =>
        fetchForecast<Briefing>(config, `chase-setup?setup_id=${encodeURIComponent(row.setup_id)}`, requestSignal)))
      return selectBriefing(records.flatMap(record => record.status === "fulfilled" ? [record.value] : []), Date.now()) ? "today" : "outlook"
    }, 10_000, signal)
  } catch { return "outlook" }
}

export function nextPotentialFrame(frames: PotentialPayload["frames"], now = Date.now()) {
  const nextHour = Math.ceil(now / 3_600_000) * 3_600_000
  return [...frames].sort((a, b) => Date.parse(a.valid_time) - Date.parse(b.valid_time)).find(frame => Date.parse(frame.valid_time) >= nextHour)
}
export function decisionInQueue(decision: string | null | undefined, queue: "drafts" | "briefings") {
  return decision !== undefined && (queue === "briefings" ? decision === "approved" : decision !== "approved")
}

export async function readSetupDecisions(config: Parameters<typeof fetchForecast>[0], rows: Array<{ setup_id: string }>, signal: AbortSignal) {
  return Promise.all(rows.map(async row => {
    try {
      const record = await fetchForecast<{ workflow?: { decision?: { decision?: string | null } | null } }>(config,
        `chase-setup?setup_id=${encodeURIComponent(row.setup_id)}`, signal)
      return [row.setup_id, record.workflow?.decision?.decision ?? null] as const
    } catch { return [row.setup_id, undefined] as const }
  }))
}
