import { Capacitor } from "@capacitor/core";
import {
  capabilitiesForRuntime,
  platformSupportsPersistentChaseTracking,
  type PlatformCapabilities,
} from "./platformCapabilityModel";

export type { PlatformCapabilities };

export function getPlatformCapabilities(): PlatformCapabilities {
  const platform = Capacitor.getPlatform();
  const nativeRuntime = Capacitor.isNativePlatform();
  return capabilitiesForRuntime({
    platform,
    nativeRuntime,
    wakeLockSupported: typeof navigator !== "undefined" && "wakeLock" in navigator,
  });
}

export { platformSupportsPersistentChaseTracking };
