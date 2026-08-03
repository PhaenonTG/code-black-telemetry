import { useEffect, useState } from "react";
import codeblackShield from "../assets/codeblack-shield.png";

const BOOT_MESSAGES = ["LINKING TELEMETRY", "CALIBRATING RADAR", "SITUATIONAL AWARENESS ONLINE"];
const MESSAGE_INTERVAL_MS = 620;
const AUTO_DISMISS_MS = 2500;
const EXIT_DURATION_MS = 380;
const REDUCED_MOTION_MS = 500;

export function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const [exiting, setExiting] = useState(false);
  const [messageIndex, setMessageIndex] = useState(0);
  const [reducedMotion] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  const finish = () => {
    setExiting((already) => {
      if (already) return already;
      window.setTimeout(onComplete, reducedMotion ? 0 : EXIT_DURATION_MS);
      return true;
    });
  };

  useEffect(() => {
    const dismissTimer = window.setTimeout(finish, reducedMotion ? REDUCED_MOTION_MS : AUTO_DISMISS_MS);
    return () => window.clearTimeout(dismissTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const messageTimer = window.setInterval(() => {
      setMessageIndex((index) => Math.min(index + 1, BOOT_MESSAGES.length - 1));
    }, MESSAGE_INTERVAL_MS);
    return () => window.clearInterval(messageTimer);
  }, [reducedMotion]);

  return (
    <div className={exiting ? "cb-splash cb-splash--exiting" : "cb-splash"} role="presentation" onClick={finish}>
      <div className="cb-splash__ring" aria-hidden="true" />
      <img src={codeblackShield} alt="" className="cb-splash__logo" />
      <strong className="cb-splash__title">
        CODE BLACK <em>OPS</em>
      </strong>
      <span className="cb-splash__tagline">Situational Awareness</span>
      <div className="cb-splash__status">
        <span>{BOOT_MESSAGES[reducedMotion ? BOOT_MESSAGES.length - 1 : messageIndex]}</span>
        <div className="cb-splash__bar">
          <em />
        </div>
      </div>
      <div className="cb-splash__hint">Tap to skip</div>
    </div>
  );
}
