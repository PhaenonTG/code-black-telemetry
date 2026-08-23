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
