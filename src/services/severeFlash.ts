import type { AlertProduct } from "./situational";

// Module singleton, same subscribe/notify shape as breadcrumbTrail.ts/settings.ts -- the trigger
// (a new tornado/PDS alert appearing in useAlertProducts' GPS-scoped feed) and the display (a
// full-screen overlay mounted once at the App root) are decoupled so any future trigger source
// (e.g. a Pi-side alert push) can reuse the same overlay without threading new props through.
type Listener = (alert: AlertProduct) => void;

const listeners = new Set<Listener>();

export function triggerSevereFlash(alert: AlertProduct) {
  listeners.forEach((listener) => listener(alert));
}

export function subscribeSevereFlash(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
