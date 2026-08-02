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
export interface SevereReportInput {
  reportType: "S" | "W";
  tornado: boolean;
  funnelCloud: boolean;
  wallCloud: boolean;
  rotation: boolean;
  hail: boolean;
  wind: boolean;
  flood: boolean;
  flashFlood: boolean;
  other: boolean;
  hailSizeIn: number | null;
  windSpeedMph: number | null;
  windMeasured: boolean;
  damage: boolean;
  injury: boolean;
  narrative: string;
  lat: number;
  lon: number;
  gpsSourced: boolean;
  postToNwsChat: boolean;
  postToTwitter: boolean;
}

interface ReportResult {
  success: boolean;
  error: string;
}

function isoStamp(date: Date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export async function submitSevereReport(input: SevereReportInput): Promise<ReportResult> {
  if (!currentAccount) return { success: false, error: "Not signed in to Spotter Network." };
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch("https://www.spotternetwork.org/report/severe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: currentAccount.id,
        report_type: input.reportType,
        stamp: isoStamp(new Date()),
        stamp_exact: 1,
        tornado: input.tornado ? 1 : 0,
        funnelcloud: input.funnelCloud ? 1 : 0,
        wallcloud: input.wallCloud ? 1 : 0,
        rotation: input.rotation ? 1 : 0,
        hail: input.hail ? 1 : 0,
        wind: input.wind ? 1 : 0,
        flood: input.flood ? 1 : 0,
        flashflood: input.flashFlood ? 1 : 0,
        other: input.other ? 1 : 0,
        hailsize: input.hailSizeIn ?? 0,
        windspeed: input.windSpeedMph ?? 0,
        windmeasure: input.windMeasured ? 1 : 0,
        damage: input.damage ? 1 : 0,
        injury: input.injury ? 1 : 0,
        narrative: input.narrative,
        lat: input.lat,
        lon: input.lon,
        gps: input.gpsSourced ? 1 : 0,
        nwschat: input.postToNwsChat ? 1 : 0,
        twitter: input.postToTwitter ? 1 : 0,
      }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message = Array.isArray(body?.errors) ? body.errors.join(" ") : `${response.status} ${response.statusText}`;
      return { success: false, error: message || "Report submission failed." };
    }
    return { success: true, error: "" };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Report submission failed." };
  } finally {
    window.clearTimeout(timer);
  }
}

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
