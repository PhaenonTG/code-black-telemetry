import { useEffect, useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import shield from "../../../../src/assets/codeblack-shield.png"
import { Icon } from "../components/Icon"
import { supabase } from "../lib/supabase"

type Phase = "checking" | "ready" | "submitting" | "done" | "invalid-link" | "error"

// Reached via the link Supabase emails from resetPasswordForEmail() (see Login.tsx). The
// Supabase client auto-detects the recovery token in the URL and establishes a temporary
// session -- this page just waits for that, then lets the user set a new password via
// updateUser(). No custom token handling or password-reset logic is implemented here.
export default function UpdatePassword() {
  const [phase, setPhase] = useState<Phase>("checking")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    let cancelled = false

    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setPhase(data.session ? "ready" : "invalid-link")
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      if (event === "PASSWORD_RECOVERY" || session) setPhase("ready")
    })

    return () => {
      cancelled = true
      subscription.subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setPhase("error")
      return
    }
    setPhase("submitting")
    const { error } = await supabase.auth.updateUser({ password })
    setPhase(error ? "error" : "done")
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <img src={shield} alt="Code Black WX" className="auth-card__shield" />
        <p className="auth-card__kicker">CODE BLACK OPS</p>
        <h1 className="auth-card__title">Set new password</h1>

        {phase === "checking" && <p className="auth-card__subtitle">Verifying recovery link...</p>}

        {phase === "invalid-link" && (
          <>
            <p className="auth-card__status auth-card__status--error">
              This link is invalid or has expired.
            </p>
            <Link to="/" className="auth-card__link">
              Back to sign in
            </Link>
          </>
        )}

        {phase === "done" && (
          <>
            <p className="auth-card__status auth-card__status--ok">Password updated.</p>
            <Link to="/" className="auth-card__link">
              Continue to OPS
            </Link>
          </>
        )}

        {(phase === "ready" || phase === "submitting" || phase === "error") && (
          <form onSubmit={(e) => void handleSubmit(e)}>
            <label className="auth-field">
              <span>NEW PASSWORD</span>
              <div className="auth-field__password">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="auth-field__toggle"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  <Icon name={showPassword ? "eyeOff" : "eye"} />
                </button>
              </div>
            </label>
            <label className="auth-field">
              <span>CONFIRM PASSWORD</span>
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>

            {phase === "error" && (
              <p className="auth-card__status auth-card__status--error">
                Could not update password. Check both fields and try again.
              </p>
            )}

            <button type="submit" className="auth-submit" disabled={phase === "submitting"}>
              {phase === "submitting" ? "UPDATING..." : "UPDATE PASSWORD"}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
