import { MORE_ROUTE, ROUTES, type RouteDef } from "../app/routes"

export const PHONE_ROUTES = ["/", "/chase-desk", "/radar", "/status", "/more"].map(path => {
  const route = path === "/more" ? MORE_ROUTE : ROUTES.find(route => route.path === path)!
  return { path, label: (route.phoneLabel ?? route.label).toUpperCase(), title: route.label, icon: route.icon }
})

export function activePhoneRoute(pathname: string): string {
  if (pathname === "/coordination" || pathname.startsWith("/coordination/")) return "/status"
  return PHONE_ROUTES.find(({ path }) => pathname === path || (path !== "/" && pathname.startsWith(`${path}/`)))?.path ?? "/more"
}

export type NavSection = RouteDef["section"]
export const NAV_SECTIONS: readonly NavSection[] = ["OPERATE", "FORECAST", "RADAR", "TEAM", "STATUS", "ADMIN", "LABS"]
export const NAV_SECTION_LABELS: Record<NavSection, string> = {
  OPERATE: "Operate", FORECAST: "Forecast", RADAR: "Radar", TEAM: "Team", STATUS: "Status", ADMIN: "Admin", LABS: "Labs · Dev",
}

export const NAV_DETAILS: Partial<Record<string, string>> = {
  "/producer": "Program output and producer controls",
  "/chase-desk": "Chase planning desk",
  "/setup-review": "Setup drafts, horizons and briefings",
  "/analysis": "Setup drafts, horizons and briefings",
  "/": "Full operations map · desktop and tablet",
  "/field": "Field team map and field intelligence",
  "/weather": "Storm intelligence and point analysis",
  "/radar": "Private single-site radar",
  "/radar-r3": "Development radar candidate",
  "/team": "Chasers, vehicles and device readiness",
  "/producer/sources": "Streaming program health",
  "/status": "Core, providers and connectivity",
  "/status/telemetry": "Platform telemetry and attention queue",
  "/directory": "Code Black destinations and access",
  "/hurricane": "Latest NHC advisory and watch-point alerts",
  "/aegis-alerts": "Internal radar evidence · unconfirmed",
  "/soundings": "Model soundings for a point",
  "/vehicle-weather": "On-vehicle sensors per chaser",
  "/coordination": "Agent sessions and handoff queue",
  "/automation-lab": "Rehearse Aegis alert routing",
  "/settings": "Display, map layers and alerts",
}

export function navLabel(route: Pick<RouteDef, "path" | "label">): string { return route.label }
export function navDetail(route: Pick<RouteDef, "path">): string | undefined { return NAV_DETAILS[route.path] }
const BOTTOM_BAR_PATHS = new Set(PHONE_ROUTES.map(route => route.path))
export function isMoreDestination(route: RouteDef): boolean { return route.inSidebar && !BOTTOM_BAR_PATHS.has(route.path) }
export const MORE_SECTIONS = NAV_SECTIONS.map(section => ({ section, label: NAV_SECTION_LABELS[section], routes: ROUTES.filter(route => route.section === section && isMoreDestination(route)) })).filter(group => group.routes.length > 0)
