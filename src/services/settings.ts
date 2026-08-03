import { Preferences } from "@capacitor/preferences";

const PI_ENDPOINT_KEY = "codeblack.piEndpoint";
const DEFAULT_PI_ENDPOINT = "";

let currentPiEndpoint = DEFAULT_PI_ENDPOINT;
const listeners = new Set<(endpoint: string) => void>();

const CHASER_RADIUS_KEY = "codeblack.chaserRadiusMiles";
export const DEFAULT_CHASER_RADIUS_MILES = 100;
const MIN_CHASER_RADIUS_MILES = 5;
const MAX_CHASER_RADIUS_MILES = 500;

let currentChaserRadiusMiles = DEFAULT_CHASER_RADIUS_MILES;
const chaserRadiusListeners = new Set<(radiusMiles: number) => void>();

function clampChaserRadius(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_CHASER_RADIUS_MILES;
  return Math.min(MAX_CHASER_RADIUS_MILES, Math.max(MIN_CHASER_RADIUS_MILES, Math.round(value)));
}

export async function loadChaserRadiusMiles() {
  const saved = await Preferences.get({ key: CHASER_RADIUS_KEY });
  currentChaserRadiusMiles = saved.value ? clampChaserRadius(Number(saved.value)) : DEFAULT_CHASER_RADIUS_MILES;
  chaserRadiusListeners.forEach((listener) => listener(currentChaserRadiusMiles));
  return currentChaserRadiusMiles;
}

export async function saveChaserRadiusMiles(value: number) {
  currentChaserRadiusMiles = clampChaserRadius(value);
  await Preferences.set({ key: CHASER_RADIUS_KEY, value: String(currentChaserRadiusMiles) });
  chaserRadiusListeners.forEach((listener) => listener(currentChaserRadiusMiles));
  return currentChaserRadiusMiles;
}

export function getChaserRadiusMiles() {
  return currentChaserRadiusMiles;
}

export function subscribeChaserRadiusMiles(listener: (radiusMiles: number) => void) {
  chaserRadiusListeners.add(listener);
  listener(currentChaserRadiusMiles);
  return () => chaserRadiusListeners.delete(listener);
}

export type PinShape = "circle" | "diamond" | "triangle" | "star" | "square";

export interface PinStyle {
  color: string;
  shape: PinShape;
}

const TEAM_ROSTER_KEY = "codeblack.teamRoster";
const TEAM_PIN_STYLE_KEY = "codeblack.teamPinStyle";
const CHASER_PIN_STYLE_KEY = "codeblack.chaserPinStyle";
// Green is unclaimed anywhere else in this app's palette and conventionally reads as
// "friendly/team" on a tactical map -- distinct from red (warnings + your own vehicle) and amber
// (watches). Chasers default to a muted, informational white/grey. Both are just starting points;
// full override lives in Settings.
const DEFAULT_TEAM_PIN_STYLE: PinStyle = { color: "#3ddc70", shape: "diamond" };
const DEFAULT_CHASER_PIN_STYLE: PinStyle = { color: "#c7ccd6", shape: "circle" };

let currentTeamRoster: string[] = [];
const teamRosterListeners = new Set<(roster: string[]) => void>();
let currentTeamPinStyle: PinStyle = DEFAULT_TEAM_PIN_STYLE;
const teamPinStyleListeners = new Set<(style: PinStyle) => void>();
let currentChaserPinStyle: PinStyle = DEFAULT_CHASER_PIN_STYLE;
const chaserPinStyleListeners = new Set<(style: PinStyle) => void>();

export async function loadTeamRoster() {
  const saved = await Preferences.get({ key: TEAM_ROSTER_KEY });
  try {
    currentTeamRoster = saved.value ? (JSON.parse(saved.value) as string[]) : [];
  } catch {
    currentTeamRoster = [];
  }
  teamRosterListeners.forEach((listener) => listener(currentTeamRoster));
  return currentTeamRoster;
}

export async function saveTeamRoster(roster: string[]) {
  currentTeamRoster = roster.map((entry) => entry.trim()).filter(Boolean);
  await Preferences.set({ key: TEAM_ROSTER_KEY, value: JSON.stringify(currentTeamRoster) });
  teamRosterListeners.forEach((listener) => listener(currentTeamRoster));
  return currentTeamRoster;
}

export function getTeamRoster() {
  return currentTeamRoster;
}

export function subscribeTeamRoster(listener: (roster: string[]) => void) {
  teamRosterListeners.add(listener);
  listener(currentTeamRoster);
  return () => {
    teamRosterListeners.delete(listener);
  };
}

function loadPinStyleFactory(key: string, fallback: PinStyle, currentSetter: (style: PinStyle) => void, listeners: Set<(style: PinStyle) => void>) {
  return async () => {
    const saved = await Preferences.get({ key });
    let next = fallback;
    if (saved.value) {
      try {
        const parsed = JSON.parse(saved.value) as Partial<PinStyle>;
        if (parsed.color && parsed.shape) next = { color: parsed.color, shape: parsed.shape };
      } catch {
        next = fallback;
      }
    }
    currentSetter(next);
    listeners.forEach((listener) => listener(next));
    return next;
  };
}

export const loadTeamPinStyle = loadPinStyleFactory(TEAM_PIN_STYLE_KEY, DEFAULT_TEAM_PIN_STYLE, (style) => { currentTeamPinStyle = style; }, teamPinStyleListeners);
export const loadChaserPinStyle = loadPinStyleFactory(CHASER_PIN_STYLE_KEY, DEFAULT_CHASER_PIN_STYLE, (style) => { currentChaserPinStyle = style; }, chaserPinStyleListeners);

export async function saveTeamPinStyle(style: PinStyle) {
  currentTeamPinStyle = style;
  await Preferences.set({ key: TEAM_PIN_STYLE_KEY, value: JSON.stringify(style) });
  teamPinStyleListeners.forEach((listener) => listener(style));
  return style;
}

export async function saveChaserPinStyle(style: PinStyle) {
  currentChaserPinStyle = style;
  await Preferences.set({ key: CHASER_PIN_STYLE_KEY, value: JSON.stringify(style) });
  chaserPinStyleListeners.forEach((listener) => listener(style));
  return style;
}

export function getTeamPinStyle() {
  return currentTeamPinStyle;
}

export function getChaserPinStyle() {
  return currentChaserPinStyle;
}

export function subscribeTeamPinStyle(listener: (style: PinStyle) => void) {
  teamPinStyleListeners.add(listener);
  listener(currentTeamPinStyle);
  return () => {
    teamPinStyleListeners.delete(listener);
  };
}

export function subscribeChaserPinStyle(listener: (style: PinStyle) => void) {
  chaserPinStyleListeners.add(listener);
  listener(currentChaserPinStyle);
  return () => {
    chaserPinStyleListeners.delete(listener);
  };
}

function normalizeEndpoint(value: string) {
  const trimmed = value.trim().replace(/\/$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

export async function loadPiEndpoint() {
  const saved = await Preferences.get({ key: PI_ENDPOINT_KEY });
  currentPiEndpoint = normalizeEndpoint(saved.value ?? DEFAULT_PI_ENDPOINT);
  listeners.forEach((listener) => listener(currentPiEndpoint));
  return currentPiEndpoint;
}

export async function savePiEndpoint(value: string) {
  currentPiEndpoint = normalizeEndpoint(value);
  await Preferences.set({ key: PI_ENDPOINT_KEY, value: currentPiEndpoint });
  listeners.forEach((listener) => listener(currentPiEndpoint));
  return currentPiEndpoint;
}

export function getPiEndpoint() {
  return currentPiEndpoint;
}

export function subscribePiEndpoint(listener: (endpoint: string) => void) {
  listeners.add(listener);
  listener(currentPiEndpoint);
  return () => listeners.delete(listener);
}
