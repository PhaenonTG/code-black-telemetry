import { Preferences } from "@capacitor/preferences";

const ACCOUNT_KEY = "codeblack.spotterAccount";

export interface SpotterAccount {
  username: string;
  password: string;
  id: string;
  marker: string;
  canReport: boolean;
}

let currentAccount: SpotterAccount | null = null;
const listeners = new Set<(account: SpotterAccount | null) => void>();

function notify() {
  listeners.forEach((listener) => listener(currentAccount));
}

export async function loadSpotterAccount() {
  const saved = await Preferences.get({ key: ACCOUNT_KEY });
  currentAccount = saved.value ? (JSON.parse(saved.value) as SpotterAccount) : null;
  notify();
  return currentAccount;
}

export function getSpotterAccount() {
  return currentAccount;
}

export function subscribeSpotterAccount(listener: (account: SpotterAccount | null) => void) {
  listeners.add(listener);
  listener(currentAccount);
  return () => listeners.delete(listener);
}

export async function clearSpotterAccount() {
  currentAccount = null;
  await Preferences.remove({ key: ACCOUNT_KEY });
  notify();
}

interface LoginResult {
  success: boolean;
  error: string;
}

// Stores the account, including the raw password, in on-device Preferences (plaintext, unencrypted
// storage on Android/iOS) so the app can silently re-authenticate later without prompting again.
// This is an explicit, scoped decision for the pre-release/team-only phase of this app — revisit
// before any public distribution (switch to re-prompting for password rather than storing it, or
// ask Spotter Network for a dedicated non-personal app credential instead of a user login).
export async function spotterNetworkLogin(username: string, password: string): Promise<LoginResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch("https://www.spotternetwork.org/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.success) {
      const message = Array.isArray(body?.errors) ? body.errors.join(" ") : `${response.status} ${response.statusText}`;
      return { success: false, error: message || "Sign-in failed." };
    }
    currentAccount = {
      username,
      password,
      id: String(body.id ?? ""),
      marker: String(body.marker ?? ""),
      canReport: Boolean(body.CanReport),
    };
    await Preferences.set({ key: ACCOUNT_KEY, value: JSON.stringify(currentAccount) });
    notify();
    return { success: true, error: "" };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Sign-in failed." };
  } finally {
    window.clearTimeout(timer);
  }
}
