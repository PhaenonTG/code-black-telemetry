import type { ComponentProps } from "react"
import { Icon } from "../components/Icon"

export interface RouteDef {
  path: string
  label: string
  icon: ComponentProps<typeof Icon>["name"]
  // Shown in the phone bottom nav (exactly Home/Map/Weather/Alerts/More -- do not add a 6th).
  inPhoneNav: boolean
  // Shown in the desktop/tablet sidebar. "More" itself isn't a sidebar destination there --
  // desktop/tablet have room to show Fleet/Operations/Settings directly instead.
  inSidebar: boolean
}

export const ROUTES: RouteDef[] = [
  { path: "/", label: "Home", icon: "home", inPhoneNav: true, inSidebar: true },
  { path: "/map", label: "Map", icon: "map", inPhoneNav: true, inSidebar: true },
  { path: "/weather", label: "Weather", icon: "cloud", inPhoneNav: true, inSidebar: true },
  { path: "/alerts", label: "Alerts", icon: "alert", inPhoneNav: true, inSidebar: true },
  { path: "/fleet", label: "Fleet", icon: "fleet", inPhoneNav: false, inSidebar: true },
  { path: "/operations", label: "Operations", icon: "ops", inPhoneNav: false, inSidebar: true },
  { path: "/settings", label: "Settings", icon: "settings", inPhoneNav: false, inSidebar: true },
]

// "More" is a phone-only landing page listing Fleet/Operations/Settings (and anything else that
// doesn't deserve its own bottom-nav slot) -- desktop/tablet reach those directly from the sidebar.
export const MORE_ROUTE: RouteDef = { path: "/more", label: "More", icon: "more", inPhoneNav: true, inSidebar: false }

export const MORE_PAGE_LINKS = ROUTES.filter((r) => !r.inPhoneNav)
