import { Preferences } from "@capacitor/preferences";
import { redactCredentialText } from "./credentialSecurity";
import { migrateLegacyCredential, secureCredentialStore } from "./secureCredentials";
import {
  spotterReportFingerprint,
  upsertSpotterSubmissionLedger,
  validateSpotterSubmission,
  type SubmissionLedger,
  type SubmissionLedgerEntry,
} from "./spotterSubmissionPolicy";

const ACCOUNT_KEY = "codeblack.spotterAccount";
const ONBOARDING_SEEN_KEY = "codeblack.spotterOnboardingSeen";
const SUBMISSION_LEDGER_KEY = "codeblack.spotterSubmissionLedger";
const MAX_LEDGER_ENTRIES = 50;

function readLocalSeenFallback() {
  try {
    return window.localStorage.getItem(ONBOARDING_SEEN_KEY) === "true";
  } catch {
    return false;
  }
}

function writeLocalSeenFallback() {
  try {
    window.localStorage.setItem(ONBOARDING_SEEN_KEY, "true");
  } catch {
    // Preferences is the primary store; localStorage is only a web/dev fallback.
  }
}

// A one-time, skippable first-run prompt (see SpotterOnboardingPrompt.tsx) rather than gating the
// app behind sign-in -- this dashboard's core purpose (GPS, weather, radar, alerts) has nothing to
// do with Spotter Network, and a login screen blocking access to severe weather info during an
// actual emergency (forgotten password, no signal to auth) would be actively unsafe. Checked once
// at app mount; once dismissed (signed in OR skipped) it never shows again automatically -- signing
// in later is always available from Settings.
export async function hasSeenSpotterOnboarding(): Promise<boolean> {
  try {
    const saved = await Preferences.get({ key: ONBOARDING_SEEN_KEY });
    return saved.value === "true" || readLocalSeenFallback();
  } catch {
    return readLocalSeenFallback();
  }
}

export async function markSpotterOnboardingSeen(): Promise<void> {
  writeLocalSeenFallback();
  try {
    await Preferences.set({ key: ONBOARDING_SEEN_KEY, value: "true" });
  } catch {
    // The prompt is intentionally non-critical. Never trap the driver behind Spotter sign-in
    // because native preferences are temporarily unavailable.
  }
}

export interface SpotterAccount {
  username: string;
  id: string;
  marker: string;
  canReport: boolean;
}

let currentAccount: SpotterAccount | null = null;
let lastCredentialMigrationError = "";
let lastCredentialReadError = "";
const listeners = new Set<(account: SpotterAccount | null) => void>();

function notify() {
  listeners.forEach((listener) => listener(currentAccount));
}

export async function loadSpotterAccount() {
  lastCredentialMigrationError = "";
  lastCredentialReadError = "";
  const saved = await Preferences.get({ key: ACCOUNT_KEY });
  if (!saved.value) {
    currentAccount = null;
    notify();
    return currentAccount;
  }
  const parsed = JSON.parse(saved.value) as SpotterAccount & { password?: string };
  if (parsed.password) {
    const migration = await migrateLegacyCredential({
      key: "spotter-network.password",
      legacyValue: parsed.password,
      removeLegacy: async () => {
        const { password: _password, ...account } = parsed;
        await Preferences.set({ key: ACCOUNT_KEY, value: JSON.stringify(account) });
      },
    });
    if (migration.error) lastCredentialMigrationError = migration.error;
    if (!migration.removedLegacy) {
      currentAccount = {
        username: parsed.username,
        id: parsed.id,
        marker: parsed.marker,
        canReport: parsed.canReport,
      };
      notify();
      return currentAccount;
    }
  }
  currentAccount = {
    username: parsed.username,
    id: parsed.id,
    marker: parsed.marker,
    canReport: Boolean(parsed.canReport),
  };
  notify();
  return currentAccount;
}

export function getSpotterCredentialStatus() {
  return {
    migrationError: lastCredentialMigrationError,
    readError: lastCredentialReadError,
  };
}

export function getSpotterAccount() {
  return currentAccount;
}

export function subscribeSpotterAccount(listener: (account: SpotterAccount | null) => void) {
  listeners.add(listener);
  listener(currentAccount);
  return () => {
    listeners.delete(listener);
  };
}

export async function clearSpotterAccount() {
  currentAccount = null;
  await Preferences.remove({ key: ACCOUNT_KEY });
  await secureCredentialStore.deleteCredential("spotter-network.password");
  notify();
}

interface LoginResult {
  success: boolean;
  error: string;
}

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
  state?: SubmissionLedgerEntry["state"] | "FAILED";
}

function isoStamp(date: Date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

async function loadSubmissionLedger(): Promise<SubmissionLedger> {
  try {
    const saved = await Preferences.get({ key: SUBMISSION_LEDGER_KEY });
    const parsed = saved.value ? JSON.parse(saved.value) as SubmissionLedger : { entries: [] };
    return { entries: Array.isArray(parsed.entries) ? parsed.entries.slice(0, MAX_LEDGER_ENTRIES) : [] };
  } catch {
    return { entries: [] };
  }
}

async function saveSubmissionLedger(ledger: SubmissionLedger) {
  await Preferences.set({ key: SUBMISSION_LEDGER_KEY, value: JSON.stringify({ entries: ledger.entries.slice(0, MAX_LEDGER_ENTRIES) }) });
}

export async function submitSevereReport(input: SevereReportInput): Promise<ReportResult> {
  if (!currentAccount) return { success: false, error: "Not signed in to Spotter Network." };
  if (!currentAccount.canReport) return { success: false, error: "Spotter Network reporting is not enabled for this account." };
  const validationError = validateSpotterSubmission(input);
  if (validationError) return { success: false, error: validationError };
  const fingerprint = spotterReportFingerprint(currentAccount.id, input);
  const ledger = await loadSubmissionLedger();
  const existing = ledger.entries.find((entry) => entry.fingerprint === fingerprint);
  if (existing?.state === "SUBMITTED") return { success: false, state: "ALREADY_SUBMITTED", error: "This report was already submitted from this device." };
  if (existing?.state === "ALREADY_SUBMITTED") return { success: false, state: "ALREADY_SUBMITTED", error: "This report is already blocked as a duplicate on this device." };
  if (existing?.state === "UNKNOWN") return { success: false, state: "UNKNOWN", error: "A previous submission timed out and may have reached Spotter Network. Review before retrying to avoid a duplicate." };
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
      return { success: false, state: "FAILED", error: redactCredentialText(message || "Report submission failed.") };
    }
    await saveSubmissionLedger(upsertSpotterSubmissionLedger(ledger, fingerprint, "SUBMITTED"));
    return { success: true, state: "SUBMITTED", error: "" };
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === "AbortError";
    if (aborted) {
      await saveSubmissionLedger(upsertSpotterSubmissionLedger(ledger, fingerprint, "UNKNOWN"));
      return { success: false, state: "UNKNOWN", error: "Submission timed out. The result is unknown; do not blindly retry the same report." };
    }
    return { success: false, state: "FAILED", error: redactCredentialText(error instanceof Error ? error.message : "Report submission failed.") };
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
    const nextAccount: SpotterAccount = {
      username,
      id: String(body.id ?? ""),
      marker: String(body.marker ?? ""),
      canReport: Boolean(body.CanReport),
    };
    await secureCredentialStore.setCredential("spotter-network.password", password);
    const verified = await secureCredentialStore.getCredentialStatus("spotter-network.password");
    if (!verified.configured) {
      return { success: false, error: verified.error || "Credential was not saved securely." };
    }
    await Preferences.set({ key: ACCOUNT_KEY, value: JSON.stringify(nextAccount) });
    currentAccount = nextAccount;
    lastCredentialMigrationError = "";
    lastCredentialReadError = "";
    notify();
    return { success: true, error: "" };
  } catch (error) {
    return { success: false, error: redactCredentialText(error instanceof Error ? error.message : "Sign-in failed.") };
  } finally {
    window.clearTimeout(timer);
  }
}
