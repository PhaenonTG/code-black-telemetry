import type { ReactNode } from "react"
import { useAuth } from "../auth/AuthProvider"
import Login from "../pages/Login"
import Unauthorized from "../pages/Unauthorized"
import { LoadingScreen } from "./LoadingScreen"

// Production auth for ops.codeblackwx.com is Supabase Auth (email + password), enforced here --
// protected content only ever renders in the "authorized" branch. Nothing protected mounts
// before the session/authorization check resolves, so there is no flash of OPS content before
// auth is known (see AuthProvider for the session bootstrap + onAuthStateChange wiring).
export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const localPreview =
    import.meta.env.DEV &&
    window.location.hostname === "127.0.0.1" &&
    new URLSearchParams(window.location.search).get("phase1Preview") === "1"

  if (localPreview) return <>{children}</>

  switch (auth.status) {
    case "loading":
      return <LoadingScreen />
    case "signed-out":
      return <Login />
    case "unauthorized":
      return <Unauthorized />
    case "authorized":
      return <>{children}</>
  }
}
