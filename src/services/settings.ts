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
