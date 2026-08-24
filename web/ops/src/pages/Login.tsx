import { useState, type FormEvent } from "react"
import shield from "../../../../src/assets/codeblack-shield.png"
import { Icon } from "../components/Icon"
import { supabase } from "../lib/supabase"

type LoginPhase = "idle" | "submitting" | "invalid" | "network-error"
type ResetPhase = "idle" | "submitting" | "sent"

function redirectTo(path: string): string {
  return `${window.location.origin}${path}`
}

function ForgotPassword({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("")
  const [phase, setPhase] = useState<ResetPhase>("idle")

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setPhase("submitting")
    // Supabase's own response here does not distinguish "no such user" from "sent" -- the
    // client shows one generic outcome either way, so the UI can't leak account existence.
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: redirectTo("/update-password"),
    })
    setPhase("sent")
  }

  return (
    <div className="auth-card">
      <p className="auth-card__kicker">PASSWORD RECOVERY</p>
      <h1 className="auth-card__title">Reset access</h1>
      {phase === "sent" ? (
        <>
          <p className="auth-card__status auth-card__status--ok">
            If that email is on file, a recovery link is on the way. Check your inbox.
          </p>
          <button type="button" className="auth-card__link" onClick={onBack}>
            Back to sign in
          </button>
        </>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)}>
          <label className="auth-field">
            <span>EMAIL</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <button type="submit" className="auth-submit" disabled={phase === "submitting"}>
            {phase === "submitting" ? "SENDING..." : "SEND RESET LINK"}
          </button>
          <button type="button" className="auth-card__link" onClick={onBack}>
            Back to sign in
          </button>
        </form>
      )}
    </div>
  )
}

export default function Login() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [phase, setPhase] = useState<LoginPhase>("idle")
  const [forgotPassword, setForgotPassword] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setPhase("submitting")
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) {
        setPhase("invalid")
        return
      }
      // On success, onAuthStateChange in AuthProvider takes over -- no local "authenticated"
      // phase needed here, this screen simply unmounts once AuthGate re-renders.
    } catch {
      setPhase("network-error")
    }
  }

  return (
    <div className="auth-screen">
      {forgotPassword ? (
        <ForgotPassword onBack={() => setForgotPassword(false)} />
      ) : (
        <div className="auth-card">
          <img src={shield} alt="Code Black WX" className="auth-card__shield" />
          <p className="auth-card__kicker">CODE BLACK OPS</p>
          <h1 className="auth-card__title">Secure operations terminal</h1>

          <form onSubmit={(e) => void handleSubmit(e)}>
            <label className="auth-field">
              <span>EMAIL</span>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (phase !== "submitting") setPhase("idle")
                }}
              />
            </label>

            <label className="auth-field">
              <span>PASSWORD</span>
              <div className="auth-field__password">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    if (phase !== "submitting") setPhase("idle")
                  }}
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

            {phase === "invalid" && (
              <p className="auth-card__status auth-card__status--error">
                AUTHENTICATION FAILED
                <br />
                Check credentials and try again.
              </p>
            )}
            {phase === "network-error" && (
              <p className="auth-card__status auth-card__status--error">
                CONNECTION FAILED
                <br />
                Check your network and try again.
              </p>
            )}

            <button type="submit" className="auth-submit" disabled={phase === "submitting"}>
              {phase === "submitting" ? "AUTHENTICATING..." : "AUTHENTICATE"}
            </button>

            <button type="button" className="auth-card__link" onClick={() => setForgotPassword(true)}>
              Forgot password?
            </button>
          </form>
        </div>
      )}

      <div className="auth-screen__status">
        <span>SECURE SESSION</span>
        <span>CODE BLACK WX</span>
        <span className="auth-screen__tagline">FROM WATCHING TO WARNING</span>
      </div>
    </div>
  )
}
