import shield from "../../../../src/assets/codeblack-shield.png"

// Minimal branded loading state shown while the Supabase session is resolving on app start,
// so protected OPS content never flashes before auth status is known (see AuthProvider).
export function LoadingScreen() {
  return (
    <div className="auth-screen">
      <div className="auth-screen__loading">
        <img src={shield} alt="" className="auth-screen__loading-shield" />
        <p className="auth-screen__loading-text">CODE BLACK OPS</p>
      </div>
    </div>
  )
}
