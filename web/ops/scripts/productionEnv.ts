export function assertProductionEnv(env: Record<string, string | undefined>): void {
  const value = env.VITE_SUPABASE_URL
  let url: URL
  try { url = new URL(value ?? "") } catch { throw new Error("PRODUCTION_SUPABASE_URL_REQUIRED") }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("PRODUCTION_SUPABASE_URL_INVALID")
  // Only browser-safe publishable keys. Never embed a secret/service-role key.
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "")) throw new Error("PRODUCTION_PUBLISHABLE_KEY_REQUIRED")
  if (env.VITE_OPS_DATA_MODE !== "LIVE_CORE" || env.VITE_CODEBLACK_CORE_BASE_URL?.replace(/\/$/, "") !== "/api/core") throw new Error("PRODUCTION_AUTHENTICATED_CORE_ROUTE_REQUIRED")
  if (!env.VITE_MAPBOX_ACCESS_TOKEN?.startsWith("pk.")) throw new Error("PRODUCTION_PUBLIC_MAP_TOKEN_REQUIRED")
}
