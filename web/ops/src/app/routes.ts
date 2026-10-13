import type { ComponentProps } from "react"
import { Icon } from "../components/Icon"

export interface RouteDef {
  path: string
  label: string
  icon: ComponentProps<typeof Icon>["name"]
  state: "LIVE" | "DEVELOPMENT"
  // Exposed in the phone navigation model. BottomNav deliberately presents
  // only five one-handed destinations; the remaining live routes are shown
  // in More.
  inPhoneNav: boolean
  // Shown in the desktop/tablet sidebar. "More" itself isn't a sidebar destination there --
  // desktop/tablet have room to show Fleet/Operations/Settings directly instead.
  inSidebar: boolean
  section: "WORKSPACES" | "ANALYSIS" | "FIELD" | "SYSTEM"
}

export const ROUTES: RouteDef[] = [
  { path: "/producer", label: "PRODUCER", icon: "stream", state: "LIVE", inPhoneNav: false, inSidebar: true, section: "WORKSPACES" },
  { path: "/workspace/chase", label: "CHASE DESK", icon: "fleet", state: "LIVE", inPhoneNav: false, inSidebar: true, section: "WORKSPACES" },
  { path: "/analysis", label: "SETUP REVIEW", icon: "models", state: "LIVE", inPhoneNav: false, inSidebar: true, section: "WORKSPACES" },
  { path: "/", label: "OPERATIONS MAP", icon: "map", state: "LIVE", inPhoneNav: true, inSidebar: true, section: "ANALYSIS" },
  { path: "/weather", label: "WEATHER ANALYSIS", icon: "cloud", state: "LIVE", inPhoneNav: false, inSidebar: true, section: "ANALYSIS" },
  { path: "/hurricane", label: "HURRICANE WATCH", icon: "cloud", state: "LIVE", inPhoneNav: false, inSidebar: true, section: "ANALYSIS" },
  { path: "/aegis-alerts", label: "AEGIS RADAR ALERTS", icon: "radar", state: "LIVE", inPhoneNav: false, inSidebar: true, section: "ANALYSIS" },
  { path: "/radar", label: "RADAR LAB", icon: "radar", state: "LIVE", inPhoneNav: true, inSidebar: true, section: "ANALYSIS" },
  { path: "/models", label: "MODELS", icon: "models", state: "DEVELOPMENT", inPhoneNav: false, inSidebar: false, section: "ANALYSIS" },
  { path: "/soundings", label: "SOUNDINGS", icon: "sounding", state: "LIVE", inPhoneNav: false, inSidebar: true, section: "ANALYSIS" },
  { path: "/consensus", label: "CONSENSUS", icon: "consensus", state: "DEVELOPMENT", inPhoneNav: false, inSidebar: false, section: "ANALYSIS" },
  { path: "/targets", label: "TARGETS", icon: "target", state: "DEVELOPMENT", inPhoneNav: false, inSidebar: false, section: "ANALYSIS" },
  { path: "/chase", label: "TEAM & DEVICES", icon: "fleet", state: "LIVE", inPhoneNav: false, inSidebar: true, section: "FIELD" },
  { path: "/field", label: "FIELD MAP", icon: "radio", state: "LIVE", inPhoneNav: false, inSidebar: true, section: "FIELD" },
  { path: "/stream", label: "PROGRAM STATUS", icon: "stream", state: "LIVE", inPhoneNav: false, inSidebar: true, section: "FIELD" },
  { path: "/system", label: "SYSTEM", icon: "system", state: "LIVE", inPhoneNav: false, inSidebar: true, section: "SYSTEM" },
  { path: "/status-center", label: "STATUS CENTER", icon: "system", state: "LIVE", inPhoneNav: false, inSidebar: true, section: "SYSTEM" },
  { path: "/automation-lab", label: "AUTOMATION LAB", icon: "ops", state: "LIVE", inPhoneNav: false, inSidebar: true, section: "SYSTEM" },
  { path: "/settings", label: "SETTINGS", icon: "settings", state: "LIVE", inPhoneNav: false, inSidebar: true, section: "SYSTEM" },
]

// "More" is a phone-only landing page listing Fleet/Operations/Settings (and anything else that
// doesn't deserve its own bottom-nav slot) -- desktop/tablet reach those directly from the sidebar.
export const MORE_ROUTE: RouteDef = { path: "/more", label: "MORE", icon: "more", state: "LIVE", inPhoneNav: true, inSidebar: false, section: "SYSTEM" }

export const MORE_PAGE_LINKS = ROUTES.filter((r) => !r.inPhoneNav && r.state === "LIVE" && r.section !== "WORKSPACES")
