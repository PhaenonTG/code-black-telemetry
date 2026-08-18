import { Preferences } from "@capacitor/preferences";

export type MissionSessionStatus = "active" | "ended";

export interface MissionSession {
  id: string;
  status: MissionSessionStatus;
  startedAt: number;
  endedAt: number | null;
  label: string;
}

const ACTIVE_SESSION_KEY = "codeblack.activeMissionSession";
const SESSION_HISTORY_KEY = "codeblack.missionSessionHistory";
const MAX_SESSION_HISTORY = 40;

let activeSession: MissionSession | null = null;
let sessionHistory: MissionSession[] = [];
const listeners = new Set<(session: MissionSession | null) => void>();

function createSessionId(now = Date.now()) {
  return `chase-${new Date(now).toISOString().replace(/\D/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 7)}`;
}

function notify() {
  listeners.forEach((listener) => listener(activeSession));
}

async function persist() {
  if (activeSession) {
    await Preferences.set({ key: ACTIVE_SESSION_KEY, value: JSON.stringify(activeSession) });
  } else {
    await Preferences.remove({ key: ACTIVE_SESSION_KEY });
  }
  await Preferences.set({ key: SESSION_HISTORY_KEY, value: JSON.stringify(sessionHistory.slice(0, MAX_SESSION_HISTORY)) });
}

export async function loadMissionSession() {
  const [activeSaved, historySaved] = await Promise.all([
    Preferences.get({ key: ACTIVE_SESSION_KEY }),
    Preferences.get({ key: SESSION_HISTORY_KEY }),
  ]);
  try {
    activeSession = activeSaved.value ? JSON.parse(activeSaved.value) as MissionSession : null;
  } catch {
    activeSession = null;
  }
  try {
    sessionHistory = historySaved.value ? JSON.parse(historySaved.value) as MissionSession[] : [];
  } catch {
    sessionHistory = [];
  }
  notify();
  return activeSession;
}

export async function startMissionSession(now = Date.now()) {
  if (activeSession?.status === "active") return activeSession;
  activeSession = {
    id: createSessionId(now),
    status: "active",
    startedAt: now,
    endedAt: null,
    label: `Chase ${new Date(now).toLocaleDateString([], { month: "short", day: "numeric" })}`,
  };
  sessionHistory = [activeSession, ...sessionHistory.filter((session) => session.id !== activeSession!.id)].slice(0, MAX_SESSION_HISTORY);
  await persist();
  notify();
  window.dispatchEvent(new CustomEvent("codeblack:mission-session", { detail: activeSession }));
  return activeSession;
}

export async function recoverMissionSession(sessionId: string, startedAt = Date.now()) {
  if (activeSession?.status === "active") {
    return activeSession.id === sessionId ? activeSession : activeSession;
  }
  const recovered: MissionSession = {
    id: sessionId,
    status: "active",
    startedAt,
    endedAt: null,
    label: `Chase ${new Date(startedAt).toLocaleDateString([], { month: "short", day: "numeric" })}`,
  };
  activeSession = recovered;
  sessionHistory = [recovered, ...sessionHistory.filter((session) => session.id !== recovered.id)].slice(0, MAX_SESSION_HISTORY);
  await persist();
  notify();
  window.dispatchEvent(new CustomEvent("codeblack:mission-session", { detail: recovered }));
  return recovered;
}

export async function endMissionSession(now = Date.now()) {
  if (!activeSession) return null;
  const ended: MissionSession = { ...activeSession, status: "ended", endedAt: now };
  sessionHistory = [ended, ...sessionHistory.filter((session) => session.id !== ended.id)].slice(0, MAX_SESSION_HISTORY);
  activeSession = null;
  await persist();
  notify();
  window.dispatchEvent(new CustomEvent("codeblack:mission-session", { detail: null }));
  return ended;
}

export function getActiveMissionSession() {
  return activeSession;
}

export function getMissionSessionHistory() {
  return sessionHistory;
}

export function subscribeMissionSession(listener: (session: MissionSession | null) => void) {
  listeners.add(listener);
  listener(activeSession);
  return () => {
    listeners.delete(listener);
  };
}
