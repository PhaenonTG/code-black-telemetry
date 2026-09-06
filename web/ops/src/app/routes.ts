import type { ComponentProps } from "react"
import { Icon } from "../components/Icon"

export interface RouteDef {
  path: string
  label: string
  icon: ComponentProps<typeof Icon>["name"]
  state: "LIVE" | "DEVELOPMENT"
  // Shown in the phone bottom nav (exactly Home/Map/Weather/Alerts/More -- do not add a 6th).
  inPhoneNav: boolean
  // Shown in the desktop/tablet sidebar. "More" itself isn't a sidebar destination there --
  // desktop/tablet have room to show Fleet/Operations/Settings directly instead.
  inSidebar: boolean
}

export const ROUTES: RouteDef[] = [
  { path: "/", label: "LIVE OPS", icon: "ops", state: "LIVE", inPhoneNav: true, inSidebar: true },
  { path: "/radar", label: "RADAR", icon: "radar", state: "LIVE", inPhoneNav: true, inSidebar: true },
  { path: "/storm-intel", label: "STORM INTEL", icon: "cloud", state: "LIVE", inPhoneNav: true, inSidebar: true },
  { path: "/models", label: "MODELS", icon: "models", state: "DEVELOPMENT", inPhoneNav: false, inSidebar: true },
  { path: "/soundings", label: "SOUNDINGS", icon: "sounding", state: "DEVELOPMENT", inPhoneNav: false, inSidebar: true },
  { path: "/consensus", label: "CONSENSUS", icon: "consensus", state: "DEVELOPMENT", inPhoneNav: false, inSidebar: true },
  { path: "/targets", label: "TARGETS", icon: "target", state: "DEVELOPMENT", inPhoneNav: false, inSidebar: true },
  { path: "/fleet", label: "FLEET", icon: "fleet", state: "LIVE", inPhoneNav: true, inSidebar: true },
  { path: "/stream", label: "STREAM", icon: "stream", state: "DEVELOPMENT", inPhoneNav: false, inSidebar: true },
  { path: "/system", label: "SYSTEM", icon: "system", state: "LIVE", inPhoneNav: false, inSidebar: true },
  { path: "/settings", label: "SETTINGS", icon: "settings", state: "LIVE", inPhoneNav: false, inSidebar: true },
]

// "More" is a phone-only landing page listing Fleet/Operations/Settings (and anything else that
// doesn't deserve its own bottom-nav slot) -- desktop/tablet reach those directly from the sidebar.
export const MORE_ROUTE: RouteDef = { path: "/more", label: "MORE", icon: "more", state: "LIVE", inPhoneNav: true, inSidebar: false }

export const MORE_PAGE_LINKS = ROUTES.filter((r) => !r.inPhoneNav)
