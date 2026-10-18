// APPROVAL PROPOSAL ONLY: intentionally not imported by a serving Worker.
// migration/authorization.patch connects this exact helper to the retained public entry.
export const ADMIN_CORE_MUTATIONS = new Set([
  "api/forecast/v1/chase-setup-decision", "api/forecast/v1/chase-setup-policy",
  "api/forecast/v1/chase-setup-paid-review", "api/weather-alert/v1/settings",
  "api/ops/status-center/v1/radar-control-settings", "api/fabric/v1/aegis-policy/replay",
])

export function publicCoreRoleAllowed(role: string | null, routeKey: string, method: string): boolean {
  if (!role || !["OWNER", "ADMIN", "OPERATOR"].includes(role)) return false
  return ["GET", "HEAD"].includes(method) || !ADMIN_CORE_MUTATIONS.has(routeKey) || role === "OWNER" || role === "ADMIN"
}
