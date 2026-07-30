export type CodeBlackSoundEvent = "warning" | "gps-acquired" | "pi-connected" | "sensor-offline";

type SoundListener = (event: CodeBlackSoundEvent) => void;

let enabled = false;
const listeners = new Set<SoundListener>();

export function setCodeBlackSoundEnabled(next: boolean) {
  enabled = next;
}

export function isCodeBlackSoundEnabled() {
  return enabled;
}

export function emitCodeBlackSound(event: CodeBlackSoundEvent) {
  if (!enabled) return;
  listeners.forEach((listener) => listener(event));
}

export function subscribeCodeBlackSound(listener: SoundListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
