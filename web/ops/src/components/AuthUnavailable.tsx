import shield from "../../../../src/assets/codeblack-shield.png"

export function AuthUnavailable({ configured = true, onRetry }: { configured?: boolean; onRetry?: () => void }) {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <img src={shield} alt="Code Black WX" className="auth-card__shield" />
        <p className="auth-card__kicker">CODE BLACK OPS</p>
        <h1 className="auth-card__title">{configured ? "Access check unavailable" : "Sign-in is not configured"}</h1>
        <p className="auth-card__subtitle" role="alert">
          {configured ? "We could not verify your session or access. Check your connection and try again." : "Sign-in is unavailable for this installation. Contact the OPS administrator."}
        </p>
        {onRetry && <button type="button" className="auth-submit" onClick={onRetry}>TRY AGAIN</button>}
      </div>
    </div>
  )
}
