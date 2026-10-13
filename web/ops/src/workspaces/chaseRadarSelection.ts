import type { RadarFrame, RadarSite } from "../../../../src/services/radar"
import { radarFramesAreOperational } from "../../../../src/services/radarFailover"

export function selectRadarFrame(results: Array<{ site: RadarSite; frames: RadarFrame[] }>): { site: RadarSite; frame: RadarFrame } | null {
  const available = results.flatMap(({ site, frames }) => frames[0]?.tileTemplate ? [{ site, frame: frames[0], operational: radarFramesAreOperational(frames) }] : [])
  return available.find((item) => item.operational) ?? available.sort((a, b) => a.frame.ageSeconds - b.frame.ageSeconds)[0] ?? null
}
