import type { RadarFrame, RadarSite } from "../../../../src/services/radar"
import { radarFramesAreOperational } from "../../../../src/services/radarFailover"

export function selectRadarFrame(results: Array<{ site: RadarSite; frames: RadarFrame[] }>): { site: RadarSite; frame: RadarFrame } | null {
  const available = results.flatMap(({ site, frames }) => frames[0]?.tileTemplate ? [{ site, frame: frames[0], operational: radarFramesAreOperational(frames) }] : [])
  return available.find((item) => item.operational) ?? available.sort((a, b) => a.frame.ageSeconds - b.frame.ageSeconds)[0] ?? null
}

export async function loadRadarCandidates(
  sites: RadarSite[],
  load: (site: RadarSite) => Promise<RadarFrame[]>,
  strict = false,
): Promise<Array<{ site: RadarSite; frames: RadarFrame[] }>> {
  const results: Array<{ site: RadarSite; frames: RadarFrame[] }> = []
  for (const site of sites) {
    try {
      const frames = await load(site)
      results.push({ site, frames })
      if (radarFramesAreOperational(frames) && frames[0]?.tileTemplate) break
    } catch (error) {
      results.push({ site, frames: [] })
      if (strict) throw error
    }
  }
  return results
}
