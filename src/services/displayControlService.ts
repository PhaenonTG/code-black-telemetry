import { getPlatformCapabilities } from "./platformCapabilities";

export interface DisplayControlCapabilities {
  keepAwake: boolean;
  brightness: boolean;
}

export interface DisplayControlService {
  capabilities(): DisplayControlCapabilities;
  keepAwake(): Promise<boolean>;
  releaseKeepAwake(): Promise<void>;
  applyBrightness(level: number): Promise<boolean>;
  releaseBrightness(): Promise<void>;
}

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: "release", listener: () => void) => void;
};

let wakeLock: WakeLockSentinelLike | null = null;

export const displayControlService: DisplayControlService = {
  capabilities() {
    const capabilities = getPlatformCapabilities();
    return {
      keepAwake: capabilities.wakeLock,
      brightness: capabilities.nativeBrightness,
    };
  },
  async keepAwake() {
    if (wakeLock || typeof document === "undefined" || document.visibilityState !== "visible") return Boolean(wakeLock);
    try {
      const wakeLockApi = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> } }).wakeLock;
      wakeLock = await wakeLockApi?.request("screen") ?? null;
      wakeLock?.addEventListener?.("release", () => {
        wakeLock = null;
      });
      return Boolean(wakeLock);
    } catch {
      wakeLock = null;
      return false;
    }
  },
  async releaseKeepAwake() {
    if (!wakeLock) return;
    const lock = wakeLock;
    wakeLock = null;
    if (!lock.released) await lock.release().catch(() => undefined);
  },
  async applyBrightness(level) {
    if (typeof document === "undefined") return false;
    document.documentElement.style.setProperty("--ops-brightness", String(Math.min(1, Math.max(0.15, level))));
    document.documentElement.dataset.opsBrightness = "controlled";
    return this.capabilities().brightness;
  },
  async releaseBrightness() {
    if (typeof document === "undefined") return;
    document.documentElement.style.removeProperty("--ops-brightness");
    document.documentElement.dataset.opsBrightness = "released";
  },
};
