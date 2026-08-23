export type CredentialKey =
  | "spotter-network.password"
  | "vehicle-node.command-token"
  | "live-overlay.station-token";

export type CredentialStorageSecurityLevel = "native-secure" | "memory-only-dev" | "unavailable";

const SECRET_KEY_RE = /password|token|secret|authorization|bearer|credential|api[-_]?key/i;
const AUTH_HEADER_RE = /(authorization\s*[:=]\s*bearer\s+)([^\s,}]+)/i;

export function isKnownCredentialKey(key: string): key is CredentialKey {
  return key === "spotter-network.password" || key === "vehicle-node.command-token" || key === "live-overlay.station-token";
}

export function normalizeCredentialValue(value: string) {
  return value.trim();
}

export function credentialConfiguredLabel(configured: boolean) {
  return configured ? "CONFIGURED" : "MISSING";
}

export function redactCredentialText(value: string) {
  let redacted = value.replace(AUTH_HEADER_RE, "$1[REDACTED]");
  redacted = redacted.replace(/(["']?)(password|token|secret|credential|api[-_]?key)(["']?\s*[:=]\s*["']?)([^"',}\s]+)/gi, "$1$2$3[REDACTED]");
  return redacted;
}

export function redactCredentialRecord<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => redactCredentialRecord(item)) as T;
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(key)) {
      output[key] = child == null || child === "" ? child : "[REDACTED]";
    } else {
      output[key] = redactCredentialRecord(child);
    }
  }
  return output as T;
}

export interface CredentialMigrationResult {
  migrated: boolean;
  removedLegacy: boolean;
  preservedLegacy: boolean;
  error: string;
}

export type CredentialReadState = "configured" | "missing" | "unavailable" | "corrupt" | "error";

export interface CredentialReadResult {
  state: CredentialReadState;
  configured: boolean;
  value: string;
  error: string;
}

export function credentialMigrationResult(
  migrated: boolean,
  removedLegacy: boolean,
  error = "",
): CredentialMigrationResult {
  return {
    migrated,
    removedLegacy,
    preservedLegacy: Boolean(migrated && !removedLegacy),
    error: redactCredentialText(error),
  };
}

export function credentialReadResult(
  state: CredentialReadState,
  value = "",
  error = "",
): CredentialReadResult {
  return {
    state,
    configured: state === "configured",
    value: state === "configured" ? value : "",
    error: redactCredentialText(error),
  };
}

export function classifyCredentialReadFailure(error: unknown): CredentialReadState {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("unavailable") || lower.includes("pending") || lower.includes("not implemented") || lower.includes("not available")) return "unavailable";
  if (lower.includes("corrupt") || lower.includes("decrypt") || lower.includes("decryption") || lower.includes("key") || lower.includes("envelope")) return "corrupt";
  return "error";
}

export function credentialReadStatusLabel(result: Pick<CredentialReadResult, "state">) {
  switch (result.state) {
    case "configured":
      return "CONFIGURED";
    case "missing":
      return "MISSING";
    case "unavailable":
      return "SECURE STORAGE UNAVAILABLE";
    case "corrupt":
      return "REAUTHENTICATION REQUIRED";
    case "error":
      return "READ ERROR";
  }
}
