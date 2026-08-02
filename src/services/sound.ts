export type CodeBlackSoundEvent = "warning" | "gps-acquired" | "pi-connected" | "sensor-offline";

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

// Preferred over reading isCodeBlackSoundEnabled() once at mount — this fires immediately with
// the current value AND on every later change, so a component never shows a stale snapshot taken
// before App's async preference load resolves.
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

// Synthesized via WebAudio rather than shipping an audio asset — works fully offline (no network
// asset to fetch in a dead zone) and needs no licensed sound file.
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioContext) audioContext = new Ctor();
  if (audioContext.state === "suspended") void audioContext.resume();
  return audioContext;
}

function playTone(ctx: AudioContext, freq: number, startAt: number, durationSec: number, gainPeak = 0.22) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(freq, startAt);
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(gainPeak, startAt + 0.02);
  gain.gain.linearRampToValueAtTime(0, startAt + durationSec);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + durationSec + 0.02);
}

// warning: 4-tone alternating caution tone (aviation master-caution style) — the only pattern
// currently wired to a real trigger (new tornado/PDS-severity alert). The others are ready for
// future use but nothing calls emitCodeBlackSound() with them yet.
const TONE_PATTERNS: Record<CodeBlackSoundEvent, Array<{ freq: number; duration: number; gap: number }>> = {
  warning: [
    { freq: 880, duration: 0.16, gap: 0.06 },
    { freq: 660, duration: 0.16, gap: 0.06 },
    { freq: 880, duration: 0.16, gap: 0.06 },
    { freq: 660, duration: 0.16, gap: 0.12 },
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
    playTone(ctx, step.freq, t, step.duration);
    t += step.duration + step.gap;
  }
}

let playerStarted = false;

// Call once at app startup. Idempotent so it's safe to call from multiple mount points.
export function startCodeBlackSoundPlayer() {
  if (playerStarted) return;
  playerStarted = true;
  subscribeCodeBlackSound(playPattern);
}
