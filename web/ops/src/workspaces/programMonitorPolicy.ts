const PATH = /^\/api\/producer\/v1\/preview\/hls\/(?:index\.m3u8|program-[0-9a-f]{32}-[0-9]{1,16}\.ts)$/
// A two-second workstation push plus a four-second UI poll can exceed the
// five-second proof lifetime. Poll faster; never widen the media freshness gate.
export const PROGRAM_STATUS_POLL_MS = 1000
export function isProgramMediaUrl(value: string, origin: string): boolean {
  try { const url = new URL(value, origin); return url.origin === origin && PATH.test(url.pathname) && !url.search && !url.hash && !url.username && !url.password } catch { return false }
}
export function currentMediaTimestamp(value: string | null, now = Date.now()): number | null {
  const time = value ? Date.parse(value) : NaN
  return Number.isFinite(time) && now - time >= -2000 && now - time <= 5000 ? time : null
}
const COMPOSITION = /^[a-f0-9]{24}$/
export function mediaCompositionMatches(expected: string | undefined, received: string | null): boolean {
  return expected === undefined ? received === null || COMPOSITION.test(received) : COMPOSITION.test(expected) && received === expected
}
export type ProgramRenderStatus = {
  engine?: string; observedAt?: string; source_state?: string;
  composition?: { id?: string };
  program?: { state?: string; compositionId?: string; generation?: string; lastFrameAt?: string };
  previews?: { program?: { state?: string } };
}
export function currentProgramRender(status: ProgramRenderStatus | null, now = Date.now()): boolean {
  if (!status || status.previews?.program?.state !== "ACTIVE") return false
  if (status.engine !== "obs") return status.source_state === "SOURCE_LIVE"
  const id = status.composition?.id, program = status.program
  return Boolean(id && COMPOSITION.test(id) && program?.state === "RENDERING" && program.compositionId === id
    && /^[a-f0-9]{32}$/.test(program.generation ?? "") && currentMediaTimestamp(program.lastFrameAt ?? null, now)
    && currentMediaTimestamp(status.observedAt ?? null, now))
}
