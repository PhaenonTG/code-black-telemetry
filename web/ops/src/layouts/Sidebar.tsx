import { NavLink } from "react-router-dom"
import { Icon } from "../components/Icon"

const LINKS = [
  { path: "/producer", label: "Producer", icon: "camera" },
  { path: "/chase", label: "Chase", icon: "fleet" },
  { path: "/analysis", label: "Analysis", icon: "analysis" },
  { path: "/map", label: "Map", icon: "map" },
  { path: "/radar", label: "Radar", icon: "radar" },
  { path: "/more", label: "More", icon: "more" },
] as const

export function Sidebar() {
  return <nav className="desk-sidebar" aria-label="Desktop navigation">
    <div className="desk-sidebar__links">{LINKS.map((link) => <NavLink key={link.path} to={link.path} className={({ isActive }) => `desk-sidebar__link${isActive ? " is-active" : ""}`}><Icon name={link.icon} /><span>{link.label}</span></NavLink>)}</div>
    <NavLink to="/settings" className={({ isActive }) => `desk-sidebar__link desk-sidebar__settings${isActive ? " is-active" : ""}`}><Icon name="settings" /><span>Settings</span></NavLink>
  </nav>
}
