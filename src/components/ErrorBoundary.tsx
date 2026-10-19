import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  secondsLeft: number;
  loopDetected: boolean;
}

// A crashed dashboard mounted on a moving vehicle can't wait for someone to reach over and tap
// "Reload" -- it should come back on its own. But a silent auto-reload with no guard can turn one
// bad render into an infinite reload flicker if the crash is persistent (bad build, corrupted
// Preferences value, etc). Recent-reload timestamps in sessionStorage (cleared on a real app
// restart, unlike localStorage) let this tell "one transient crash" from "crash looping" apart --
// 3+ auto-reloads inside 2 minutes disables the countdown and falls back to the manual button
// instead of reloading forever.
const RELOAD_LOG_KEY = "codeblack.crashReloadLog";
const LOOP_WINDOW_MS = 2 * 60_000;
const LOOP_THRESHOLD = 3;
const AUTO_RELOAD_SECONDS = 8;

function recentReloadCount(): number {
  try {
    const raw = sessionStorage.getItem(RELOAD_LOG_KEY);
    const timestamps: number[] = raw ? JSON.parse(raw) : [];
    const now = Date.now();
    return timestamps.filter((t) => now - t < LOOP_WINDOW_MS).length;
  } catch {
    return 0;
  }
}

function logReloadAttempt() {
  try {
    const raw = sessionStorage.getItem(RELOAD_LOG_KEY);
    const timestamps: number[] = raw ? JSON.parse(raw) : [];
    const now = Date.now();
    const recent = timestamps.filter((t) => now - t < LOOP_WINDOW_MS);
    recent.push(now);
    sessionStorage.setItem(RELOAD_LOG_KEY, JSON.stringify(recent));
  } catch {
    // sessionStorage unavailable (private mode, quota) -- fall through to manual reload only.
  }
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, secondsLeft: AUTO_RELOAD_SECONDS, loopDetected: false };
  private countdownTimer: ReturnType<typeof setInterval> | null = null;

  static getDerivedStateFromError(error: Error): State {
    return { error, secondsLeft: AUTO_RELOAD_SECONDS, loopDetected: recentReloadCount() >= LOOP_THRESHOLD };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Code Black UI crash", error, info.componentStack);
    if (this.state.loopDetected) return;
    this.countdownTimer = setInterval(() => {
      this.setState((prev) => {
        if (prev.secondsLeft <= 1) {
          this.handleReload();
          return prev;
        }
        return { ...prev, secondsLeft: prev.secondsLeft - 1 };
      });
    }, 1000);
  }

  componentWillUnmount() {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
  }

  handleReload = () => {
    logReloadAttempt();
    window.location.reload();
  };

  handleCancelAutoReload = () => {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.setState({ loopDetected: true });
  };

  render() {
    const { error, secondsLeft, loopDetected } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="cb-crash-screen">
        <div className="cb-crash-card">
          <div className="cb-crash-title">SYSTEM FAULT</div>
          <p className="cb-crash-message">
            {loopDetected
              ? "The dashboard keeps hitting this error right after reloading, so auto-recovery has been stopped. Your Pi connection and last-known telemetry are unaffected."
              : `The dashboard hit an unexpected error and stopped rendering. Auto-recovering in ${secondsLeft}s -- your Pi connection and last-known telemetry are unaffected.`}
          </p>
          <pre className="cb-crash-detail">{error.message}</pre>
          <div className="cb-crash-actions">
            <button className="cb-crash-reload" onClick={this.handleReload}>Reload Now</button>
            {!loopDetected && (
              <button className="cb-crash-cancel" onClick={this.handleCancelAutoReload}>Cancel Auto-Reload</button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
