import { NavLink } from "react-router-dom"
import { Icon } from "../components/Icon"

const LINKS = [
  { path: "/producer", label: "Producer", icon: "camera" },
  { path: "/chase", label: "Chase", icon: "target" },
  { path: "/analysis", label: "Analysis", icon: "analysis" },
  { path: "/more", label: "More", icon: "more" },
] as const

export function BottomNav() {
  return <nav className="desk-bottom-nav" aria-label="Phone navigation">{LINKS.map((link) => <NavLink key={link.path} to={link.path} className={({ isActive }) => `desk-bottom-nav__link${isActive ? " is-active" : ""}`}><Icon name={link.icon} /><span>{link.label}</span></NavLink>)}</nav>
}
