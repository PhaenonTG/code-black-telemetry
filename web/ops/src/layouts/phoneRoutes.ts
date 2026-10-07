export const PHONE_ROUTES = [
  { path: "/", label: "HOME", icon: "home" as const },
  { path: "/radar", label: "RADAR", icon: "radar" as const },
  { path: "/system", label: "OPS", icon: "system" as const },
  { path: "/ai", label: "AEGIS", icon: "ops" as const },
  { path: "/more", label: "MORE", icon: "more" as const },
]

// Detail screens are reachable through More; keep a navigation context selected
// instead of leaving every tab inactive on Settings/Weather/Field/Chase.
export function activePhoneRoute(pathname: string): string {
  return PHONE_ROUTES.find(({ path }) => pathname === path || (path !== "/" && pathname.startsWith(`${path}/`)))?.path ?? "/more"
}
