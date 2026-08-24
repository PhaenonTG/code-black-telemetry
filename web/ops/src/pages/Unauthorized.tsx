import shield from "../../../../src/assets/codeblack-shield.png"
import { useAuth } from "../auth/AuthProvider"

// Shown when Supabase Auth accepted valid credentials but the account has no active row in
// public.profiles -- a signed-in identity is not, by itself, authorization to use OPS. This
// is not a login failure, so it gets its own honest state rather than reusing the login screen.
export default function Unauthorized() {
  const { signOut } = useAuth()

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <img src={shield} alt="Code Black WX" className="auth-card__shield" />
        <p className="auth-card__kicker">CODE BLACK OPS</p>
        <h1 className="auth-card__title">Account not authorized</h1>
        <p className="auth-card__subtitle">This account is not approved for OPS access.</p>
        <p className="auth-card__body">Contact the OPS administrator to request access.</p>
        <button type="button" className="auth-submit" onClick={() => void signOut()}>
          SIGN OUT
        </button>
      </div>
    </div>
  )
}
