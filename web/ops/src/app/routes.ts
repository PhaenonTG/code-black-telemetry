import type { ComponentProps } from "react"
import { Icon } from "../components/Icon"

export interface RouteDef {
  path: string
  label: string
  phoneLabel?: string
  icon: ComponentProps<typeof Icon>["name"]
  state: "LIVE" | "DEVELOPMENT"
  inPhoneNav: boolean
  inSidebar: boolean
  section: "OPERATE" | "FORECAST" | "RADAR" | "TEAM" | "STATUS" | "ADMIN" | "LABS"
}

export const ROUTES: RouteDef[] = [
  { path: "/", label: "Ops Map", phoneLabel: "Home", icon: "map", state: "LIVE", inPhoneNav: true, inSidebar: true, section: "OPERATE" },
  { path: "/field", label: "Field Map", icon: "radio", state: "LIVE", inPhoneNav: false, inSidebar: true, section: "OPERATE" },
  { path: "/chase-desk", label: "Chase Desk", phoneLabel: "Chase", icon: "target", state: "LIVE", inPhoneNav: true, inSidebar: true, section: "OPERATE" },
  { path: "/producer", label: "Producer", icon: "stream", state: "LIVE", inPhoneNav: false, inSidebar: true, section: "OPERATE" },
  { path: "/analysis", label: "Setup Review", icon: "models", state: "LIVE", inPhoneNav: false, inSidebar: true, section: "FORECAST" },
  { path: "/weather", label: "Weather Analysis", icon: "cloud", state: "LIVE", inPhoneNav: false, inSidebar: true, section: "FORECAST" },
  { path: "/soundings", label: "Soundings", icon: "sounding", state: "LIVE", inPhoneNav: false, inSidebar: true, section: "FORECAST" },
  { path: "/hurricane", label: "Hurricane", icon: "hurricane", state: "LIVE", inPhoneNav: false, inSidebar: true, section: "FORECAST" },
  { path: "/radar", label: "Radar Lab", phoneLabel: "Radar", icon: "radar", state: "LIVE", inPhoneNav: true, inSidebar: true, section: "RADAR" },
  { path: "/aegis-alerts", label: "Aegis Alerts", icon: "alert", state: "LIVE", inPhoneNav: false, inSidebar: true, section: "RADAR" },
  { path: "/team", label: "Team", icon: "team", state: "LIVE", inPhoneNav: false, inSidebar: true, section: "TEAM" },
  { path: "/vehicle-weather", label: "Vehicle Weather", icon: "fleet", state: "LIVE", inPhoneNav: false, inSidebar: true, section: "TEAM" },
  { path: "/status", label: "Status", phoneLabel: "Status", icon: "system", state: "LIVE", inPhoneNav: true, inSidebar: true, section: "STATUS" },
  { path: "/coordination", label: "Coordination", icon: "consensus", state: "LIVE", inPhoneNav: false, inSidebar: true, section: "STATUS" },
  { path: "/directory", label: "Directory", icon: "directory", state: "LIVE", inPhoneNav: false, inSidebar: true, section: "ADMIN" },
  { path: "/settings", label: "Settings", icon: "settings", state: "LIVE", inPhoneNav: false, inSidebar: true, section: "ADMIN" },
  { path: "/radar-r3", label: "Radar R3", icon: "experiment", state: "DEVELOPMENT", inPhoneNav: false, inSidebar: true, section: "LABS" },
  { path: "/automation-lab", label: "Automation Lab", icon: "ops", state: "DEVELOPMENT", inPhoneNav: false, inSidebar: true, section: "LABS" },
  { path: "/models", label: "Models", icon: "models", state: "DEVELOPMENT", inPhoneNav: false, inSidebar: false, section: "LABS" },
  { path: "/consensus", label: "Consensus", icon: "consensus", state: "DEVELOPMENT", inPhoneNav: false, inSidebar: false, section: "LABS" },
  { path: "/targets", label: "Targets", icon: "target", state: "DEVELOPMENT", inPhoneNav: false, inSidebar: false, section: "LABS" },
 ]

export const MORE_ROUTE: RouteDef = { path: "/more", label: "More", phoneLabel: "More", icon: "more", state: "LIVE", inPhoneNav: true, inSidebar: false, section: "ADMIN" }

export const ROUTE_ALIASES = {
  "/setup-review": "/analysis",
  "/workspace/chase": "/chase-desk",
  "/chase": "/team",
  "/fleet": "/team",
  "/stream": "/producer/sources",
  "/program-status": "/producer/sources",
  "/system": "/status/health",
  "/status-center": "/status/telemetry",
} as const

export function routeForPath(path: string): RouteDef | undefined {
  const canonical = ROUTE_ALIASES[path as keyof typeof ROUTE_ALIASES] ?? path
  return [...ROUTES, MORE_ROUTE].filter(route => canonical === route.path || (route.path !== "/" && canonical.startsWith(`${route.path}/`))).sort((a, b) => b.path.length - a.path.length)[0]
}

export function routeEyebrow(route: RouteDef): string {
  return route.section.toLowerCase() === route.label.toLowerCase() ? route.section : `${route.section} · ${route.label}`
}
