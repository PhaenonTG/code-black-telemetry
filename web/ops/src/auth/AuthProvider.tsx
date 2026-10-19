import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import type { Session } from "@supabase/supabase-js"
import { supabase } from "../lib/supabase"
import { LatestRequest } from "../pages/latestRequest"

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
  | { status: "unconfigured" }
  | { status: "error" }
  | { status: "signed-out" }
  | { status: "unauthorized" }
  | { status: "authorized"; session: Session; profile: OpsProfile }

type AuthContextValue = AuthStatus & {
  signOut: () => Promise<void>
  retry: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function fetchActiveProfile(userId: string): Promise<OpsProfile | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw error
  if (!data || !data.active || !["OWNER", "ADMIN", "OPERATOR"].includes(data.role)) return null
  return { role: data.role as OpsRole, active: data.active }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthStatus>({ status: "loading" })
  const [retryNonce, setRetryNonce] = useState(0)

  useEffect(() => {
    if (!supabase) {
      setState({ status: "unconfigured" })
      return
    }
    const requests = new LatestRequest()

    async function resolve(session: Session | null) {
      const request = requests.begin()
      if (!session) {
        setState({ status: "signed-out" })
        return
      }
      setState(current => current.status === "authorized" && current.session.user.id === session.user.id ? current : { status: "loading" })
      try {
        const profile = await fetchActiveProfile(session.user.id)
        if (!requests.isCurrent(request)) return
        setState(profile ? { status: "authorized", session, profile } : { status: "unauthorized" })
      } catch {
        if (requests.isCurrent(request)) setState({ status: "error" })
      }
    }

    setState({ status: "loading" })
    const bootstrap = requests.begin()
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!requests.isCurrent(bootstrap)) return
      if (error) setState({ status: "error" })
      else void resolve(data.session)
    }).catch(() => {
      if (requests.isCurrent(bootstrap)) setState({ status: "error" })
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      void resolve(session)
    })

    return () => {
      requests.cancel()
      subscription.subscription.unsubscribe()
    }
  }, [retryNonce])

  async function signOut() {
    if (!supabase) return
    try {
      const { error } = await supabase.auth.signOut()
      if (error) setState({ status: "error" })
    } catch {
      setState({ status: "error" })
    }
  }

  return <AuthContext.Provider value={{ ...state, signOut, retry: () => setRetryNonce(value => value + 1) }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider")
  return ctx
}
