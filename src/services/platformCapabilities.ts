import { Capacitor } from "@capacitor/core";

export interface PlatformCapabilities {
  platform: string;
  nativeRuntime: boolean;
  backgroundLocation: boolean;
  foregroundLocationService: boolean;
  notifications: boolean;
  nativeBrightness: boolean;
  wakeLock: boolean;
  ble: boolean;
  automotive: boolean;
  desktopNotifications: boolean;
}

export function getPlatformCapabilities(): PlatformCapabilities {
  const platform = Capacitor.getPlatform();
  const nativeRuntime = Capacitor.isNativePlatform();
  const androidNative = platform === "android" && nativeRuntime;
  const iosNative = platform === "ios" && nativeRuntime;
  const web = platform === "web";

  return {
    platform,
    nativeRuntime,
    backgroundLocation: androidNative,
    foregroundLocationService: androidNative,
    notifications: androidNative || iosNative || web,
    nativeBrightness: false,
    wakeLock: typeof navigator !== "undefined" && "wakeLock" in navigator,
    ble: androidNative || iosNative || web,
    automotive: androidNative || iosNative,
    desktopNotifications: web,
  };
}

export function platformSupportsPersistentChaseTracking(capabilities = getPlatformCapabilities()) {
  return capabilities.backgroundLocation || capabilities.foregroundLocationService;
}
