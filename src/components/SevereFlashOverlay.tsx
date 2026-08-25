import { useEffect, useRef, useState } from "react";
import { subscribeSevereFlash } from "../services/severeFlash";
import type { AlertProduct } from "../services/situational";

const AUTO_DISMISS_MS = 5_000;

// A silent visual-only flash is useless to a driver whose eyes are on the road, not the tablet.
// Synthesized rather than an audio asset -- no file to fail to load, works offline, and a two-tone
// alternating tone reads as "urgent alarm" without needing a real siren sample bundled/licensed.
function playAlertTone() {
  try {
    const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const ctx = new AudioContextCtor();
    const tones = [880, 660, 880, 660];
    tones.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      const start = ctx.currentTime + index * 0.3;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.26);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.28);
    });
    window.setTimeout(() => void ctx.close(), tones.length * 300 + 200);
  } catch {
    // Audio is a courtesy, not a dependency -- the visual flash still fires regardless.
  }
}

export function SevereFlashOverlay() {
  const [alert, setAlert] = useState<AlertProduct | null>(null);
  const dismissTimer = useRef<number | null>(null);

  useEffect(() => {
    return subscribeSevereFlash((next) => {
      setAlert(next);
      playAlertTone();
      if (dismissTimer.current) window.clearTimeout(dismissTimer.current);
      dismissTimer.current = window.setTimeout(() => setAlert(null), AUTO_DISMISS_MS);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (dismissTimer.current) window.clearTimeout(dismissTimer.current);
    };
  }, []);

  if (!alert) return null;

  const dismiss = () => {
    if (dismissTimer.current) window.clearTimeout(dismissTimer.current);
    setAlert(null);
  };

  return (
    <div className="severe-flash-overlay" role="alertdialog" aria-label={alert.title} onClick={dismiss}>
      <div className="severe-flash-overlay__badge">{alert.severity === "pds" ? "PDS TORNADO WARNING" : "TORNADO WARNING"}</div>
      <div className="severe-flash-overlay__title">{alert.title}</div>
      {alert.headline && <div className="severe-flash-overlay__headline">{alert.headline}</div>}
      <div className="severe-flash-overlay__hint">Tap to dismiss</div>
    </div>
  );
}
