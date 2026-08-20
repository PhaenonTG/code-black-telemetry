export interface PlatformCapabilities {
  platform: string;
  nativeRuntime: boolean;
  backgroundLocation: boolean;
  backgroundExecution: boolean;
  nativePersistentLocation: boolean;
  notifications: boolean;
  nativeBrightness: boolean;
  wakeLock: boolean;
  ble: boolean;
  automotive: boolean;
  desktopNotifications: boolean;
}

export function capabilitiesForRuntime(input: {
  platform: string;
  nativeRuntime: boolean;
  wakeLockSupported: boolean;
}): PlatformCapabilities {
  const androidNative = input.platform === "android" && input.nativeRuntime;
  const iosNative = input.platform === "ios" && input.nativeRuntime;
  const web = input.platform === "web";

  return {
    platform: input.platform,
    nativeRuntime: input.nativeRuntime,
    backgroundLocation: androidNative,
    backgroundExecution: androidNative,
    nativePersistentLocation: androidNative,
    notifications: androidNative || iosNative || web,
    nativeBrightness: false,
    wakeLock: input.wakeLockSupported,
    ble: androidNative || iosNative || web,
    automotive: androidNative || iosNative,
    desktopNotifications: web,
  };
}

export function platformSupportsPersistentChaseTracking(capabilities: PlatformCapabilities) {
  return capabilities.nativePersistentLocation && capabilities.backgroundLocation && capabilities.backgroundExecution;
}
