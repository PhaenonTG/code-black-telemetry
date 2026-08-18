import { App as CapApp } from "@capacitor/app";
import type { PluginListenerHandle } from "@capacitor/core";
import type { CockpitMode } from "../App";
import { loadDisplaySettings, subscribeDisplaySettings, type DisplaySettings } from "./settings";
import { displayControlService } from "./displayControlService";

let currentSettings: DisplaySettings | null = null;
let currentCockpitMode: CockpitMode = "chase";
let lifecycleListener: PluginListenerHandle | null = null;

function shouldKeepAwake(settings: DisplaySettings, cockpitMode: CockpitMode) {
  if (settings.autoEnableDuringChase && cockpitMode === "chase") return true;
  return settings.wakeMode === "keep-awake-dim" || settings.wakeMode === "keep-awake-bright";
}

function applyBrightness(settings: DisplaySettings | null) {
  if (!settings || settings.wakeMode !== "keep-awake-bright") {
    void displayControlService.releaseBrightness();
    return;
  }
  void displayControlService.applyBrightness(settings.opsBrightness);
}

async function reconcileDisplayState() {
  const settings = currentSettings;
  if (!settings) return;
  applyBrightness(settings);
  if (shouldKeepAwake(settings, currentCockpitMode)) {
    await displayControlService.keepAwake();
  } else {
    await displayControlService.releaseKeepAwake();
  }
}

export function setDisplayCockpitMode(mode: CockpitMode) {
  currentCockpitMode = mode;
  void reconcileDisplayState();
}

export async function startDisplayController(initialMode: CockpitMode) {
  currentCockpitMode = initialMode;
  await loadDisplaySettings();
  const unsubscribe = subscribeDisplaySettings((settings) => {
    currentSettings = settings;
    void reconcileDisplayState();
  });
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      void reconcileDisplayState();
    } else {
      void displayControlService.releaseKeepAwake();
    }
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);
  lifecycleListener = await CapApp.addListener("appStateChange", ({ isActive }) => {
    if (isActive) {
      void reconcileDisplayState();
    } else {
      void displayControlService.releaseKeepAwake();
      applyBrightness(null);
    }
  }).catch(() => null);
  void reconcileDisplayState();
  return () => {
    unsubscribe();
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    void lifecycleListener?.remove();
    lifecycleListener = null;
    void displayControlService.releaseKeepAwake();
    applyBrightness(null);
  };
}
