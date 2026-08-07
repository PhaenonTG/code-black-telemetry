import { useState } from "react";
import { createPortal } from "react-dom";
import { markSpotterOnboardingSeen, spotterNetworkLogin } from "../services/spotterAccount";

// One-time, skippable first-run prompt -- NOT a login gate. See markSpotterOnboardingSeen's
// comment in spotterAccount.ts for why: this dashboard's core purpose (GPS, weather, radar,
// alerts) doesn't depend on Spotter Network, and blocking access to severe weather info behind
// sign-in would be actively unsafe during a real emergency. Dismissing this (sign in, skip, or
// close) marks it seen for good -- signing in later is always available from Settings.
export function SpotterOnboardingPrompt({ onDismiss }: { onDismiss: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const dismiss = () => {
    void markSpotterOnboardingSeen();
    onDismiss();
  };

  const signIn = async () => {
    setBusy(true);
    setError("");
    const result = await spotterNetworkLogin(username.trim(), password);
    setBusy(false);
    if (result.success) {
      dismiss();
    } else {
      setError(result.error);
    }
  };

  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="spotter-onboarding-title">
      <div className="product-modal spotter-onboarding-modal">
        <div className="modal-head">
          <div>
            <div className="cb-panel__title">Spotter Network</div>
            <h2 id="spotter-onboarding-title">Sign In?</h2>
          </div>
          <button className="icon-button" onClick={dismiss} aria-label="Skip for now">X</button>
        </div>
        <div className="modal-scroll spotter-onboarding-body">
          <p>Signing in upgrades Chasers to real-time positions and contact info instead of the anonymous public feed, and lets you submit severe reports from this app. Optional -- everything else works fine without it.</p>
          <div className="settings-row settings-row--stack">
            <input
              className="settings-input"
              placeholder="Username"
              autoCapitalize="none"
              autoCorrect="off"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            <input
              className="settings-input"
              placeholder="Password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              className="settings-action"
              disabled={busy || !username.trim() || !password}
              onClick={() => void signIn()}
            >
              {busy ? "Signing In..." : "Sign In"}
            </button>
            {error && <span className="cb-note cb-note--warn">{error}</span>}
          </div>
          <div className="spotter-onboarding-actions">
            <a className="settings-action" href="https://www.spotternetwork.org/account/register" target="_blank" rel="noreferrer">Create Account</a>
            <button className="settings-action" onClick={dismiss}>Skip For Now</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
