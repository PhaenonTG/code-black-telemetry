import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";

export async function openExternalUrl(url: string) {
  if (Capacitor.isNativePlatform()) {
    try {
      await Browser.open({ url });
      return;
    } catch {
      // Fall through to the web path so the tap still does something on devices
      // missing a native browser handler.
    }
  }

  window.open(url, "_blank", "noopener,noreferrer");
}
