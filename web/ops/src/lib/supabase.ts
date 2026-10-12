import { createClient } from "@supabase/supabase-js"

type PublicAuthConfig = { url: string; publishableKey: string }

function buildConfig(): PublicAuthConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
  // Test/example values must never override the production Worker bootstrap.
  return url && publishableKey && !url.includes("example.supabase.co")
    ? { url, publishableKey }
    : null
}

async function resolveConfig(): Promise<PublicAuthConfig> {
  const embedded = buildConfig()
  if (embedded) return embedded
  // Vitest imports the auth client without a browser origin or Worker. This fixture is never
  // selected by a production build, where the Worker supplies the real public bootstrap.
  if (import.meta.env.MODE === "test") {
    return { url: "https://example.supabase.co", publishableKey: "test-public-key" }
  }
  const response = await fetch("/api/auth/config", { cache: "no-store" })
  if (!response.ok) throw new Error("OPS authentication bootstrap is unavailable.")
  const value = await response.json() as Partial<PublicAuthConfig>
  if (!value.url || !value.publishableKey || !value.url.startsWith("https://")) {
    throw new Error("OPS authentication bootstrap is invalid.")
  }
  return { url: value.url, publishableKey: value.publishableKey }
}

// Session persistence is Supabase's own default (localStorage-backed, auto refresh) --
// see AuthProvider for how the app reacts to session changes via onAuthStateChange.
const config = await resolveConfig()
export const supabase = createClient(config.url, config.publishableKey)
