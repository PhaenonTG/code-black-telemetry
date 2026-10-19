import { replayAegisPolicy, type AegisRecordedReplay, type AegisStatus } from "../../../core/aegisFeed"
import type { OpsCoreConfig } from "../../../core/config"

/** Page-open replay waits for the first known cutoff. Status polling never triggers another POST. */
export function recordedReplaySession(config: OpsCoreConfig, signal: AbortSignal,
  receive: (value: AegisRecordedReplay) => void, fail: (message: string) => void) {
  let opened = false, cutoff = 85
  let request: AbortController | null = null
  const refresh = async () => {
    if (signal.aborted || !opened) return
    request?.abort()
    const controller = new AbortController()
    request = controller
    const abort = () => controller.abort()
    signal.addEventListener("abort", abort, { once: true })
    try {
      const result = await replayAegisPolicy<AegisRecordedReplay>(config,
        { mode: "recorded", evidenceCutoff: cutoff, limit: 10 }, controller.signal)
      if (result.mode !== "recorded") throw new Error("Unexpected Core replay mode")
      if (!controller.signal.aborted) receive(result)
    } catch (error) {
      if (!controller.signal.aborted) fail(error instanceof Error ? error.message : "Recorded scans unavailable")
    } finally { signal.removeEventListener("abort", abort) }
  }
  return {
    status(value: AegisStatus) {
      cutoff = value.screen.cutoff ?? 85
      if (!opened) { opened = true; void refresh() }
    },
    refresh,
  }
}
