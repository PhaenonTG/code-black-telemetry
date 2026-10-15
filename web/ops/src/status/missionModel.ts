import type { StatusCenterDocument, StatusProject } from "./statusCenterClient"

export type CheckState = "PASS" | "WATCH" | "BLOCKED" | "UNKNOWN"
export interface ReadinessCheck { id: string; label: string; state: CheckState; detail: string }

const good = (state?: string) => state === "HEALTHY" || state === "LIVE" || state === "ONLINE"
const bad = (state?: string) => ["OFFLINE", "FAILED", "CRITICAL", "STALE"].includes(state ?? "")
const caution = (state?: string) => ["DEGRADED", "WARNING", "AGING"].includes(state ?? "")

export function hostImpacts(document: StatusCenterDocument) {
  const projects = document.projects ?? []
  const hosts = document.hosts ?? []
  const ids = new Set(projects.flatMap((project) => project.services.map((service) => service.host)))
  return [...ids].map((id) => {
    const host = hosts.find((item) => item.id === id)
    const linked = projects.filter((project) => project.services.some((service) => service.host === id))
    const affected = linked.filter((project) => project.services.some((service) => service.host === id && !good(service.state)))
    return { id, name: host?.name ?? id, state: host?.state ?? "UNKNOWN", reason: host?.state_reason,
      projects: linked.map((project) => project.name), affected: affected.map((project) => project.name) }
  }).sort((a, b) => {
    const severity = (state: string) => bad(state) ? 3 : caution(state) ? 2 : good(state) ? 0 : 1
    return severity(b.state) - severity(a.state) || b.affected.length - a.affected.length
  })
}

export function chaseReadiness(document: StatusCenterDocument): { state: "READY" | "CHECK" | "HOLD"; checks: ReadinessCheck[] } {
  const service = (id: string) => document.services?.find((item) => item.id === id)?.state
  const host = (id: string) => document.hosts?.find((item) => item.id === id)?.state
  const radarState = String(document.radar?.state ?? "UNKNOWN")
  const storageState = String(document.storage?.state ?? "UNKNOWN")
  const stream = document.streaming?.sources as Array<{ state?: string; publisher_online?: boolean }> | undefined
  const field = [service("spencer-striker-weather"), service("spencer-striker-nav")]
  const routing = [service("weather-alert-feed"), service("discord-bot"), service("edge-notification-dispatch")]
  const checks: ReadinessCheck[] = [
    { id: "radar", label: "RADAR FRESHNESS", state: radarState === "FRESH" ? "PASS" : radarState === "AGING" ? "WATCH" : bad(radarState) ? "BLOCKED" : "UNKNOWN", detail: `Radar product: ${radarState}` },
    { id: "field", label: "STRIKER FIELD", state: field.every(good) ? "PASS" : field.some(bad) ? "BLOCKED" : field.some(good) || field.some(caution) ? "WATCH" : "UNKNOWN", detail: `Weather ${field[0] ?? "UNKNOWN"} · Nav ${field[1] ?? "UNKNOWN"}` },
    { id: "stream", label: "LIVE PUBLISHER", state: stream?.some((item) => item.publisher_online || item.state === "LIVE") ? "PASS" : "WATCH", detail: stream?.some((item) => item.publisher_online || item.state === "LIVE") ? "At least one stream publishing" : "No stream publishing; verify before going on air" },
    { id: "alerts", label: "ALERT ROUTING", state: routing.every(good) ? "PASS" : routing.some(bad) ? "BLOCKED" : routing.some(caution) ? "WATCH" : "UNKNOWN", detail: `Feed ${routing[0] ?? "UNKNOWN"} · Discord ${routing[1] ?? "UNKNOWN"} · Dispatch ${routing[2] ?? "UNKNOWN"}` },
    { id: "storage", label: "STORAGE", state: storageState === "HEALTHY" ? "PASS" : storageState === "WARNING" ? "WATCH" : storageState === "CRITICAL" ? "BLOCKED" : "UNKNOWN", detail: `Storage: ${storageState}` },
    { id: "network", label: "CORE + EDGE", state: good(host("core")) && good(host("edge")) ? "PASS" : bad(host("core")) || bad(host("edge")) ? "BLOCKED" : "UNKNOWN", detail: `Core ${host("core") ?? "UNKNOWN"} · Edge ${host("edge") ?? "UNKNOWN"}` },
  ]
  return { state: checks.some((check) => check.state === "BLOCKED") ? "HOLD" : checks.every((check) => check.state === "PASS") ? "READY" : "CHECK", checks }
}

export function projectHealthCounts(project: StatusProject) {
  const healthy = project.healthy_count ?? project.services.filter((service) => good(service.state)).length
  const unknown = project.unknown_count ?? project.services.filter((service) => !good(service.state) && !bad(service.state)).length
  return { healthy, unknown, monitored: project.monitored_count, expected: project.expected_count }
}
