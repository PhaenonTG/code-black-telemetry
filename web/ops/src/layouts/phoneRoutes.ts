import { ROUTES, type RouteDef } from "../app/routes"

export const PHONE_ROUTES = [
  { path: "/", label: "HOME", icon: "home" as const, title: "Home" },
  { path: "/radar", label: "RADAR", icon: "radar" as const, title: "Radar Lab" },
  { path: "/system", label: "OPS", icon: "system" as const, title: "System health" },
  { path: "/ai", label: "AEGIS", icon: "ops" as const, title: "Aegis console" },
  { path: "/more", label: "MORE", icon: "more" as const, title: "More destinations" },
]

// Detail screens are reachable through More; keep a navigation context selected
// instead of leaving every tab inactive on Settings/Weather/Field/Chase.
export function activePhoneRoute(pathname: string): string {
  return PHONE_ROUTES.find(({ path }) => pathname === path || (path !== "/" && pathname.startsWith(`${path}/`)))?.path ?? "/more"
}

// ---- Shared navigation presentation metadata (desktop sidebar + phone More) ----
// Route identity (path), authorization (every route stays behind the same AuthGate) and the
// canonical RouteDef labels in app/routes.ts are unchanged; these maps only adjust what is shown.

export type NavSection = RouteDef["section"]
export const NAV_SECTIONS: readonly NavSection[] = ["WORKSPACES", "ANALYSIS", "FIELD", "SYSTEM"]

// Section headings no longer repeat an item name ("SYSTEM" section containing "SYSTEM") or a page
// title ("ANALYSIS" section vs the Setup Review page titled ANALYSIS).
export const NAV_SECTION_LABELS: Record<NavSection, string> = {
  WORKSPACES: "Workspaces",
  ANALYSIS: "Maps & analysis",
  FIELD: "Field operations",
  SYSTEM: "Admin & preferences",
}

// Display-only overrides. "/system" reads SYSTEM HEALTH, matching the Settings link wording.
export const NAV_DISPLAY_LABELS: Partial<Record<string, string>> = {
  "/system": "SYSTEM HEALTH",
}

// One-line context so similar destinations are distinguishable (Operations Map vs Field Map).
export const NAV_DETAILS: Partial<Record<string, string>> = {
  "/producer": "Program output and producer controls",
  "/workspace/chase": "Chase planning desk",
  "/analysis": "Setup drafts, horizons and briefings",
  "/": "Full operations map · desktop and tablet",
  "/field": "Field team map and field intelligence",
  "/weather": "Storm intelligence and point analysis",
  "/radar": "Private single-site radar",
  "/radar-r3": "Development radar candidate",
  "/chase": "Chasers, vehicles and device readiness",
  "/stream": "Streaming program health",
  "/system": "Core, providers and connectivity",
  "/status-center": "Platform telemetry and attention queue",
  "/directory": "Code Black destinations and access",
}

export function navLabel(route: Pick<RouteDef, "path" | "label">): string {
  return NAV_DISPLAY_LABELS[route.path] ?? route.label
}

export function navDetail(route: Pick<RouteDef, "path">): string | undefined {
  return NAV_DETAILS[route.path]
}

// Paths that are already one tap away in the phone bottom bar ("/" = HOME, "/radar" = RADAR, ...).
const BOTTOM_BAR_PATHS = new Set(PHONE_ROUTES.map((route) => route.path))

// Phone More list: same live routes the desktop sidebar exposes (including the Workspaces
// Chase Desk / Setup Review / Producer), minus destinations already in the bottom bar.
// The Operations Map ("/") is the phone Home route, where the app deliberately renders the
// phone command surface instead of the map, so it is not duplicated here as a dead-end link.
export function isMoreDestination(route: RouteDef): boolean {
  return route.inSidebar && (route.state === "LIVE" || route.path === "/radar-r3") && !BOTTOM_BAR_PATHS.has(route.path)
}

export const MORE_SECTIONS = NAV_SECTIONS.map((section) => ({
  section,
  label: NAV_SECTION_LABELS[section],
  routes: ROUTES.filter((route) => route.section === section && isMoreDestination(route)),
})).filter((group) => group.routes.length > 0)
