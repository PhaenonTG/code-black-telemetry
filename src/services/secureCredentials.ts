import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  classifyCredentialReadFailure,
  credentialMigrationResult,
  credentialReadResult,
  isKnownCredentialKey,
  normalizeCredentialValue,
  type CredentialKey,
  type CredentialMigrationResult,
  type CredentialReadResult,
  type CredentialStorageSecurityLevel,
} from "./credentialSecurity";

interface SecureCredentialNativePlugin {
  setCredential(options: { key: string; value: string }): Promise<void>;
  getCredential(options: { key: string }): Promise<{ value: string | null }>;
  deleteCredential(options: { key: string }): Promise<void>;
  hasCredential(options: { key: string }): Promise<{ value: boolean }>;
}

export interface CredentialStorageInfo {
  available: boolean;
  securityLevel: CredentialStorageSecurityLevel;
  provider: string;
  detail: string;
}

export interface CredentialStore {
  setCredential(key: CredentialKey, value: string): Promise<void>;
  getCredential(key: CredentialKey): Promise<string>;
  getCredentialStatus(key: CredentialKey): Promise<CredentialReadResult>;
  deleteCredential(key: CredentialKey): Promise<void>;
  hasCredential(key: CredentialKey): Promise<boolean>;
  getStorageInfo(): CredentialStorageInfo;
}

const NativeSecureCredentials = registerPlugin<SecureCredentialNativePlugin>("CodeBlackSecureCredentials");
const memoryFallback = new Map<CredentialKey, string>();

function assertKnownKey(key: CredentialKey) {
  if (!isKnownCredentialKey(key)) throw new Error("Unknown credential key.");
}

function nativeStorageInfo(): CredentialStorageInfo {
  const platform = Capacitor.getPlatform();
  if (platform === "android" && Capacitor.isNativePlatform()) {
    return {
      available: true,
      securityLevel: "native-secure",
      provider: "Android Keystore",
      detail: "Secrets are encrypted with an app-private Android Keystore AES-GCM key.",
    };
  }
  if (platform === "ios" && Capacitor.isNativePlatform()) {
    return {
      available: true,
      securityLevel: "native-secure",
      provider: "iOS Keychain",
      detail: "Secrets are stored in the app Keychain after first device unlock and do not sync through iCloud.",
    };
  }
  return {
    available: true,
    securityLevel: "memory-only-dev",
    provider: "Development memory store",
    detail: "Web preview stores credentials in memory only and will require re-entry after reload.",
  };
}

export function createSecureCredentialStore(): CredentialStore {
  return {
    async setCredential(key, value) {
      assertKnownKey(key);
      const normalized = normalizeCredentialValue(value);
      if (!normalized) {
        await this.deleteCredential(key);
        return;
      }
      const info = nativeStorageInfo();
      if (info.securityLevel === "native-secure") {
        await NativeSecureCredentials.setCredential({ key, value: normalized });
        return;
      }
      if (info.securityLevel === "memory-only-dev") {
        memoryFallback.set(key, normalized);
        return;
      }
      throw new Error(info.detail);
    },
    async getCredential(key) {
      const result = await this.getCredentialStatus(key);
      if (result.state === "configured" || result.state === "missing") return result.value;
      throw new Error(result.error || "Credential could not be read securely.");
    },
    async getCredentialStatus(key) {
      assertKnownKey(key);
      const info = nativeStorageInfo();
      if (info.securityLevel === "native-secure") {
        try {
          const result = await NativeSecureCredentials.getCredential({ key });
          const value = result.value ?? "";
          return value ? credentialReadResult("configured", value) : credentialReadResult("missing");
        } catch (error) {
          return credentialReadResult(classifyCredentialReadFailure(error), "", error instanceof Error ? error.message : "Credential could not be read securely.");
        }
      }
      if (info.securityLevel === "memory-only-dev") {
        const value = memoryFallback.get(key) ?? "";
        return value ? credentialReadResult("configured", value) : credentialReadResult("missing");
      }
      return credentialReadResult("unavailable", "", info.detail);
    },
    async deleteCredential(key) {
      assertKnownKey(key);
      const info = nativeStorageInfo();
      if (info.securityLevel === "native-secure") {
        await NativeSecureCredentials.deleteCredential({ key });
        return;
      }
      memoryFallback.delete(key);
    },
    async hasCredential(key) {
      assertKnownKey(key);
      const info = nativeStorageInfo();
      if (info.securityLevel === "native-secure") {
        try {
          const result = await NativeSecureCredentials.hasCredential({ key });
          return result.value;
        } catch {
          return false;
        }
      }
      if (info.securityLevel === "memory-only-dev") return memoryFallback.has(key);
      return false;
    },
    getStorageInfo: nativeStorageInfo,
  };
}

export const secureCredentialStore = createSecureCredentialStore();

export async function migrateLegacyCredential(options: {
  key: CredentialKey;
  legacyValue: string | null | undefined;
  removeLegacy: () => Promise<void>;
  store?: CredentialStore;
}): Promise<CredentialMigrationResult> {
  const legacyValue = normalizeCredentialValue(options.legacyValue ?? "");
  if (!legacyValue) return credentialMigrationResult(false, false);
  const store = options.store ?? secureCredentialStore;
  try {
    await store.setCredential(options.key, legacyValue);
    const verified = await store.getCredential(options.key);
    if (verified !== legacyValue) {
      return credentialMigrationResult(true, false, "Secure credential verification failed.");
    }
    await options.removeLegacy();
    return credentialMigrationResult(true, true);
  } catch (error) {
    return credentialMigrationResult(true, false, error instanceof Error ? error.message : "Credential migration failed.");
  }
}

export function createMemoryCredentialStore(): CredentialStore {
  const values = new Map<CredentialKey, string>();
  return {
    async setCredential(key, value) {
      assertKnownKey(key);
      const normalized = normalizeCredentialValue(value);
      if (normalized) values.set(key, normalized);
      else values.delete(key);
    },
    async getCredential(key) {
      assertKnownKey(key);
      return values.get(key) ?? "";
    },
    async getCredentialStatus(key) {
      assertKnownKey(key);
      const value = values.get(key) ?? "";
      return value ? credentialReadResult("configured", value) : credentialReadResult("missing");
    },
    async deleteCredential(key) {
      assertKnownKey(key);
      values.delete(key);
    },
    async hasCredential(key) {
      assertKnownKey(key);
      return values.has(key);
    },
    getStorageInfo() {
      return {
        available: true,
        securityLevel: "memory-only-dev",
        provider: "Test memory store",
        detail: "Unit-test credential store.",
      };
    },
  };
}

