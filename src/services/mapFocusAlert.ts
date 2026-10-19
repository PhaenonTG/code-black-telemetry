// Module-singleton pub/sub, same shape as severeFlash.ts/breadcrumbTrail.ts -- lets a map layer
// (deep inside AtlasMap, no direct line back to App.tsx's page state) request "open this alert's
// full details" without threading a callback prop through every component in between. AlertsFullPanel
// subscribes and opens the matching product's modal once its own data is loaded; App.tsx's existing
// "codeblack:view-all-alerts" event (already wired to navigate to the Alerts page) handles getting
// there -- this only carries *which* alert to focus once you arrive.
let listeners: Array<(alertId: string) => void> = [];

export function requestAlertFocus(alertId: string) {
  listeners.forEach((listener) => listener(alertId));
}

export function subscribeAlertFocus(listener: (alertId: string) => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((entry) => entry !== listener);
  };
}
