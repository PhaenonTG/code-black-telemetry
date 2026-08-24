import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import type { Session } from "@supabase/supabase-js"
import { supabase } from "../lib/supabase"

export type OpsRole = "OWNER" | "ADMIN" | "OPERATOR"

export interface OpsProfile {
  role: OpsRole
  active: boolean
}

// Public signup is disabled and every login is checked against Supabase Auth, but a valid
// Supabase account is not by itself authorization to use OPS -- "unauthorized" covers a
// signed-in user with no active row in public.profiles (see supabase/migrations). That
// authorization boundary is enforced server-side by RLS; this client state only reflects it.
export type AuthStatus =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "unauthorized" }
  | { status: "authorized"; session: Session; profile: OpsProfile }

type AuthContextValue = AuthStatus & {
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function fetchActiveProfile(userId: string): Promise<OpsProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("user_id", userId)
    .maybeSingle()
  if (error || !data || !data.active) return null
  return { role: data.role as OpsRole, active: data.active }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthStatus>({ status: "loading" })

  useEffect(() => {
    let cancelled = false

    async function resolve(session: Session | null) {
      if (!session) {
        if (!cancelled) setState({ status: "signed-out" })
        return
      }
      const profile = await fetchActiveProfile(session.user.id)
      if (cancelled) return
      setState(profile ? { status: "authorized", session, profile } : { status: "unauthorized" })
    }

    void supabase.auth.getSession().then(({ data }) => resolve(data.session))

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      void resolve(session)
    })

    return () => {
      cancelled = true
      subscription.subscription.unsubscribe()
    }
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
  }

  return <AuthContext.Provider value={{ ...state, signOut }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider")
  return ctx
}
