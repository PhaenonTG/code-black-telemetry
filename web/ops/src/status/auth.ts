// Auth state architecture for the OPS web shell. There is no production backend auth today --
// this defines the state machine the UI is built around so a real auth integration (or Cloudflare
// Access, see docs/ARCHITECTURE.md) slots in later without a UI rewrite.
export type AuthState =
  | { status: "AUTH_REQUIRED" }
  | { status: "AUTHENTICATING" }
  | { status: "AUTHENTICATED"; mode: "production" | "dev-demo" }
  | { status: "AUTH_ERROR"; message: string };

// Dev-only demo gate: a local-storage flag, NOT a security boundary. It exists purely so the
// shell has something to show in local development without a real backend. It must never be
// reachable in a production deployment -- callers gate this behind import.meta.env.DEV.
const DEV_DEMO_KEY = "codeblack-ops-dev-demo-unlocked";

export function isDevDemoUnlocked(): boolean {
  if (!import.meta.env.DEV) return false;
  try { return window.localStorage.getItem(DEV_DEMO_KEY) === "1"; } catch { return false; }
}

export function setDevDemoUnlocked(unlocked: boolean) {
  if (!import.meta.env.DEV) return;
  try {
    if (unlocked) window.localStorage.setItem(DEV_DEMO_KEY, "1");
    else window.localStorage.removeItem(DEV_DEMO_KEY);
  } catch { /* non-fatal */ }
}
