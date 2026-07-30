import { Preferences } from "@capacitor/preferences";

const PI_ENDPOINT_KEY = "codeblack.piEndpoint";
const DEFAULT_PI_ENDPOINT = "";

let currentPiEndpoint = DEFAULT_PI_ENDPOINT;
const listeners = new Set<(endpoint: string) => void>();

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
