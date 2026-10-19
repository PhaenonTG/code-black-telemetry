export type CodeBlackSoundEvent =
  | "warning"
  | "severe-warning"
  | "tornado-warning"
  | "pds-warning"
  | "gps-acquired"
  | "pi-connected"
  | "sensor-offline";

export const SOUND_ENABLED_PREF_KEY = "codeblack.soundEnabled";

type SoundListener = (event: CodeBlackSoundEvent) => void;
type EnabledListener = (enabled: boolean) => void;

let enabled = false;
const listeners = new Set<SoundListener>();
const enabledListeners = new Set<EnabledListener>();

export function setCodeBlackSoundEnabled(next: boolean) {
  enabled = next;
  enabledListeners.forEach((listener) => listener(next));
}

export function isCodeBlackSoundEnabled() {
  return enabled;
}

// Preferred over reading isCodeBlackSoundEnabled() once at mount: this fires immediately with
// the current value and on every later change, so components do not show a stale preference value.
export function subscribeCodeBlackSoundEnabled(listener: EnabledListener) {
  enabledListeners.add(listener);
  listener(enabled);
  return () => enabledListeners.delete(listener);
}

export function emitCodeBlackSound(event: CodeBlackSoundEvent) {
  if (!enabled) return;
  listeners.forEach((listener) => listener(event));
}

export function subscribeCodeBlackSound(listener: SoundListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioContext) audioContext = new Ctor();
  if (audioContext.state === "suspended") void audioContext.resume();
  return audioContext;
}

type ToneStep = {
  freq: number;
  duration: number;
  gap: number;
  endFreq?: number;
  gain?: number;
  type?: OscillatorType;
};

function playTone(ctx: AudioContext, step: ToneStep, startAt: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = step.type ?? "square";
  osc.frequency.setValueAtTime(step.freq, startAt);
  if (step.endFreq != null) {
    osc.frequency.exponentialRampToValueAtTime(step.endFreq, startAt + Math.max(step.duration - 0.02, 0.02));
  }
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(step.gain ?? 0.22, startAt + 0.015);
  gain.gain.linearRampToValueAtTime(0, startAt + step.duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + step.duration + 0.02);
}

const TONE_PATTERNS: Record<CodeBlackSoundEvent, ToneStep[]> = {
  warning: [
    { freq: 680, duration: 0.14, gap: 0.05 },
    { freq: 860, duration: 0.14, gap: 0.05 },
    { freq: 680, duration: 0.14, gap: 0.1 },
  ],
  "severe-warning": [
    { freq: 560, duration: 0.16, gap: 0.05 },
    { freq: 760, duration: 0.16, gap: 0.05 },
    { freq: 560, duration: 0.2, gap: 0.1 },
  ],
  "tornado-warning": [
    { freq: 740, endFreq: 1180, duration: 0.22, gap: 0.04, gain: 0.26 },
    { freq: 1180, endFreq: 740, duration: 0.22, gap: 0.04, gain: 0.26 },
    { freq: 740, endFreq: 1180, duration: 0.22, gap: 0.08, gain: 0.26 },
    { freq: 1180, duration: 0.18, gap: 0.02, gain: 0.24 },
  ],
  "pds-warning": [
    { freq: 380, duration: 0.18, gap: 0.03, gain: 0.28, type: "sawtooth" },
    { freq: 960, endFreq: 1320, duration: 0.2, gap: 0.03, gain: 0.3 },
    { freq: 380, duration: 0.18, gap: 0.03, gain: 0.28, type: "sawtooth" },
    { freq: 1320, endFreq: 820, duration: 0.24, gap: 0.05, gain: 0.3 },
    { freq: 520, duration: 0.18, gap: 0.03, gain: 0.28 },
    { freq: 1180, duration: 0.28, gap: 0.08, gain: 0.3 },
  ],
  "sensor-offline": [{ freq: 340, duration: 0.28, gap: 0 }],
  "pi-connected": [
    { freq: 520, duration: 0.1, gap: 0.04 },
    { freq: 780, duration: 0.14, gap: 0 },
  ],
  "gps-acquired": [{ freq: 620, duration: 0.12, gap: 0 }],
};

function playPattern(event: CodeBlackSoundEvent) {
  const ctx = getAudioContext();
  if (!ctx) return;
  let t = ctx.currentTime;
  for (const step of TONE_PATTERNS[event]) {
    playTone(ctx, step, t);
    t += step.duration + step.gap;
  }
}

let playerStarted = false;

export function startCodeBlackSoundPlayer() {
  if (playerStarted) return;
  playerStarted = true;
  subscribeCodeBlackSound(playPattern);
}
