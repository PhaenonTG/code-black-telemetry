import { useState, type ReactNode } from "react"
import { isDevDemoUnlocked, setDevDemoUnlocked, type AuthState } from "../status/auth"

// Production protection for ops.codeblackwx.com is Cloudflare Access (see docs/ARCHITECTURE.md) --
// by the time a request reaches this JS bundle in production, Access has already authenticated
// the person at the edge. This gate's only real job in production is to stay out of the way.
// In local development (no Access, no backend), it shows a clearly-labeled demo gate instead of
// silently exposing the full UI -- so "no auth configured" never looks the same as "authenticated".
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() =>
    import.meta.env.PROD
      ? { status: "AUTHENTICATED", mode: "production" }
      : isDevDemoUnlocked()
        ? { status: "AUTHENTICATED", mode: "dev-demo" }
        : { status: "AUTH_REQUIRED" },
  )

  if (state.status === "AUTHENTICATED") return <>{children}</>

  return (
    <div className="auth-gate">
      <div className="auth-gate__card">
        <p className="auth-gate__kicker">CODE BLACK OPS — DEVELOPMENT PREVIEW</p>
        <h1>Not a production login.</h1>
        <p className="auth-gate__body">
          This build has no backend authentication. In production, ops.codeblackwx.com is
          intended to sit behind Cloudflare Access -- this screen only exists so local
          development doesn't silently expose the full shell with nothing in front of it.
        </p>
        {state.status === "AUTH_ERROR" && <p className="auth-gate__error">{state.message}</p>}
        <button
          type="button"
          className="auth-gate__button"
          onClick={() => {
            setState({ status: "AUTHENTICATING" })
            setDevDemoUnlocked(true)
            window.setTimeout(() => setState({ status: "AUTHENTICATED", mode: "dev-demo" }), 200)
          }}
        >
          {state.status === "AUTHENTICATING" ? "Entering..." : "Continue (dev only)"}
        </button>
      </div>
    </div>
  )
}
