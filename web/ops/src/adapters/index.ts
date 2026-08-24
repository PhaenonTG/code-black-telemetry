// Platform adapter boundary. Each adapter has a browser-default implementation that degrades
// gracefully (never throws, never crashes the shell) when a capability genuinely isn't available
// in a plain browser tab. A future Capacitor native shell provides real implementations for the
// ones that need actual hardware/OS access -- the adapter interface is what stays stable across
// browser / Android / iOS / Windows, not the implementation behind it.
export { browserLocationAdapter, type LocationAdapter, type LocationState } from "./LocationAdapter";

export interface NotificationAdapter {
  supported: boolean;
  requestPermission(): Promise<"granted" | "denied" | "unsupported">;
}
export const browserNotificationAdapter: NotificationAdapter = {
  supported: typeof window !== "undefined" && "Notification" in window,
  async requestPermission() {
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
    const result = await Notification.requestPermission();
    return result === "granted" ? "granted" : "denied";
  },
};

export interface SecureStorageAdapter {
  supported: boolean;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
// Browser fallback uses localStorage -- NOT secure storage (readable by any script on the origin).
// Fine for non-sensitive UI preferences; must never hold credentials/tokens. A native shell should
// swap this for real secure storage (Keychain/Keystore) before anything sensitive touches it.
export const browserSecureStorageAdapter: SecureStorageAdapter = {
  supported: typeof window !== "undefined" && !!window.localStorage,
  async get(key) {
    try { return window.localStorage.getItem(key); } catch { return null; }
  },
  async set(key, value) {
    try { window.localStorage.setItem(key, value); } catch { /* storage unavailable/full -- non-fatal */ }
  },
  async remove(key) {
    try { window.localStorage.removeItem(key); } catch { /* non-fatal */ }
  },
};

export interface BleAdapter {
  supported: boolean;
  reason: string;
}
// Web Bluetooth exists in some Chromium browsers but is a different API surface than the
// @capacitor-community/bluetooth-le plugin the native app uses for the vehicle telemetry link --
// treating it as equivalent would be dishonest. Browser BLE is unavailable until that's built.
export const browserBleAdapter: BleAdapter = {
  supported: false,
  reason: "BLE unavailable in browser",
};

export interface BackgroundTrackingAdapter {
  supported: boolean;
  reason: string;
}
// Background/foreground-service GPS tracking while the app is backgrounded is an Android-only
// capability today (native foreground service) -- a browser tab cannot do this at all.
export const browserBackgroundTrackingAdapter: BackgroundTrackingAdapter = {
  supported: false,
  reason: "Background tracking requires the native app",
};

export interface NativeBackAdapter {
  onBack(handler: () => boolean | void): () => void;
}
// Browser back button is just history navigation -- there's no native hardware-back event to
// intercept, so this is a no-op subscription (returns an unsubscribe that does nothing) rather
// than a fake handler that implies it's catching something it isn't.
export const browserNativeBackAdapter: NativeBackAdapter = {
  onBack() {
    return () => {};
  },
};
