// Session-scoped high-water-mark for wind gust, shared between the Wind card (which tracks and
// displays it) and the severe report form (which suggests it for the Wind Speed field — a
// peak-hold reading is exactly the "measured" data that field wants). Module singleton, same
// subscribe/notify shape as services/settings.ts and services/breadcrumbTrail.ts, so both
// consumers stay in sync regardless of which page/component tree they live in. In-memory only,
// resets on app restart — a gust peak from a prior storm shouldn't linger into today's chase.

let peakGust: number | null = null;
const listeners = new Set<(peakGust: number | null) => void>();

function notify() {
  listeners.forEach((listener) => listener(peakGust));
}

export function recordGustReading(gust: number) {
  if (peakGust != null && gust <= peakGust) return;
  peakGust = gust;
  notify();
}

export function clearPeakGust() {
  peakGust = null;
  notify();
}

export function getPeakGust() {
  return peakGust;
}

export function subscribePeakGust(listener: (peakGust: number | null) => void) {
  listeners.add(listener);
  listener(peakGust);
  return () => {
    listeners.delete(listener);
  };
}
