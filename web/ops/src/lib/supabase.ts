import { createClient } from "@supabase/supabase-js"

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

// Session persistence is Supabase's own default (localStorage-backed, auto refresh) --
// see AuthProvider for how the app reacts to session changes via onAuthStateChange.
// Missing configuration must leave a usable error screen, not throw during module loading.
function configuredClient() {
  if (!url || !publishableKey) return null
  try {
    return createClient(url, publishableKey)
  } catch {
    // Invalid deployment settings get the same actionable screen as missing settings.
    return null
  }
}

export const supabase = configuredClient()
