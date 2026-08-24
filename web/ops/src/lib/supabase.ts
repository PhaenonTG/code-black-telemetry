import { createClient } from "@supabase/supabase-js"

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

if (!url || !publishableKey) {
  // Fails loudly in the console rather than silently rendering a broken login screen --
  // this only happens if the Cloudflare Pages / local env is missing the Supabase vars.
  console.error(
    "Supabase is not configured: VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required.",
  )
}

// Session persistence is Supabase's own default (localStorage-backed, auto refresh) --
// see AuthProvider for how the app reacts to session changes via onAuthStateChange.
export const supabase = createClient(url ?? "", publishableKey ?? "")
