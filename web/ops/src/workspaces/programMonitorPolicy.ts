const PATH = /^\/api\/producer\/v1\/preview\/hls\/(?:index\.m3u8|program-[0-9a-f]{32}-[0-9]{1,16}\.ts)$/
export function isProgramMediaUrl(value: string, origin: string): boolean {
  try { const url = new URL(value, origin); return url.origin === origin && PATH.test(url.pathname) && !url.search && !url.hash && !url.username && !url.password } catch { return false }
}
export function currentMediaTimestamp(value: string | null, now = Date.now()): number | null {
  const time = value ? Date.parse(value) : NaN
  return Number.isFinite(time) && now - time >= -2000 && now - time <= 5000 ? time : null
}
export function mediaCompositionMatches(expected: string | undefined, actual: string | null): boolean {
  if (actual !== null && !/^[a-f0-9]{24}$/.test(actual)) return false
  return expected === undefined ? true : /^[a-f0-9]{24}$/.test(expected) && actual === expected
}
