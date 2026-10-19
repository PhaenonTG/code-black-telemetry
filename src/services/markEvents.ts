import { Preferences } from "@capacitor/preferences";
import type { AtlasGpsPoint } from "../map/types";
import type { BreadcrumbPoint } from "./breadcrumbTrail";
import { getActiveMissionSession } from "./missionSession";

export interface MarkEvent {
  id: string;
  timestamp: number;
  lat: number;
  lon: number;
  speedMph: number | null;
  headingDeg: number | null;
  accuracyM?: number | null;
  source?: string | null;
  sessionId: string | null;
  classification: string | null;
  notes: string;
}

const MARK_EVENTS_KEY = "codeblack.markEvents";
const MAX_MARK_EVENTS = 300;

let marks: MarkEvent[] = [];
const listeners = new Set<(events: MarkEvent[]) => void>();

function notify() {
  listeners.forEach((listener) => listener(marks));
}

async function persist() {
  await Preferences.set({ key: MARK_EVENTS_KEY, value: JSON.stringify(marks.slice(0, MAX_MARK_EVENTS)) });
}

export async function loadMarkEvents() {
  const saved = await Preferences.get({ key: MARK_EVENTS_KEY });
  try {
    marks = saved.value ? JSON.parse(saved.value) as MarkEvent[] : [];
  } catch {
    marks = [];
  }
  notify();
  return marks;
}

export async function recordMarkEvent(gps: AtlasGpsPoint | null, now = Date.now()) {
  if (!gps) return { event: null, error: "NO_GPS_FIX" };
  const event: MarkEvent = {
    id: `mark-${now}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: now,
    lat: gps.lat,
    lon: gps.lon,
    speedMph: gps.speedMph ?? null,
    headingDeg: gps.headingDeg ?? null,
    accuracyM: gps.accuracyM ?? null,
    source: "web-geolocation",
    sessionId: getActiveMissionSession()?.id ?? null,
    classification: null,
    notes: "",
  };
  marks = [event, ...marks].slice(0, MAX_MARK_EVENTS);
  await persist();
  notify();
  return { event, error: "" };
}

export async function recordMarkEventFromBreadcrumb(point: BreadcrumbPoint | null, now = Date.now()) {
  if (!point) return { event: null, error: "NO_GPS_FIX" };
  const event: MarkEvent = {
    id: `mark-${now}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: now,
    lat: point.lat,
    lon: point.lon,
    speedMph: point.speedMph ?? null,
    headingDeg: point.headingDeg ?? null,
    accuracyM: point.accuracyM ?? null,
    source: point.source ?? "breadcrumb",
    sessionId: point.sessionId ?? getActiveMissionSession()?.id ?? null,
    classification: null,
    notes: "",
  };
  marks = [event, ...marks].slice(0, MAX_MARK_EVENTS);
  await persist();
  notify();
  return { event, error: "" };
}

export function subscribeMarkEvents(listener: (events: MarkEvent[]) => void) {
  listeners.add(listener);
  listener(marks);
  return () => {
    listeners.delete(listener);
  };
}
