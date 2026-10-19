export const OPS_TIME_ZONE = "America/Chicago"
const formatter = new Intl.DateTimeFormat("en-US", { timeZone: OPS_TIME_ZONE, hour: "numeric", minute: "2-digit", timeZoneName: "short" })
export function timeZoneLabel(value: Date | number | string): string {
  return formatter.formatToParts(new Date(value)).find(part => part.type === "timeZoneName")?.value ?? ""
}
export function formatOpsTime(value: Date | number | string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? formatter.format(date) : "—"
}
export function formatOpsTimestamp(value: Date | number | string, now = Date.now()): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "—"
  const hours = Math.floor(Math.max(0, now - date.getTime()) / 3_600_000)
  return `${formatOpsTime(date)}${hours >= 1 ? ` · ${hours}h ago` : ""}`
}
export function formatOpsClock(value: Date): string {
  return `${formatOpsTime(value)} · ${value.toISOString().slice(11, 16)}Z`
}
