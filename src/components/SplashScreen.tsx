import { useEffect, useRef, useState } from "react";
import codeblackShield from "../assets/codeblack-shield.png";
import { bleTelemetryClient } from "../services/telemetry/ble-client";

// Real progress, not a fixed timer -- holds on each stage until its actual signal fires (BLE/Pi
// link connects, first radar frame decodes), so a fast launch feels fast and a slow one still
// shows something true rather than a lie ("SITUATIONAL AWARENESS ONLINE" before it actually is).
// Every stage still has its own timeout so a tablet with no Pi in range (standalone mode, the
// common case away from the vehicle) never hangs waiting for a signal that will never come.
const MIN_DISPLAY_MS = 1800;
const MAX_DISPLAY_MS = 11000;
const BLE_TIMEOUT_MS = 4000;
const RADAR_TIMEOUT_MS = 9000;
const EXIT_DURATION_MS = 380;
const REDUCED_MOTION_MS = 500;

type Stage = "telemetry" | "radar" | "ready";

const STAGE_MESSAGE: Record<Stage, string> = {
  telemetry: "LINKING TELEMETRY",
  radar: "CALIBRATING RADAR",
  ready: "SITUATIONAL AWARENESS ONLINE",
};

export function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const [exiting, setExiting] = useState(false);
  const [stage, setStage] = useState<Stage>("telemetry");
  const [reducedMotion] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const startRef = useRef(Date.now());
  const bleReadyRef = useRef(false);
  const radarReadyRef = useRef(false);
  const finishedRef = useRef(false);

  const finish = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setExiting(true);
    window.setTimeout(onComplete, reducedMotion ? 0 : EXIT_DURATION_MS);
  };

  const tryAdvance = () => {
    if (!bleReadyRef.current) return;
    setStage((current) => (current === "telemetry" ? "radar" : current));
    if (!radarReadyRef.current) return;
    setStage("ready");
    const elapsed = Date.now() - startRef.current;
    window.setTimeout(finish, Math.max(0, MIN_DISPLAY_MS - elapsed));
  };

  useEffect(() => {
    if (reducedMotion) {
      const timer = window.setTimeout(finish, REDUCED_MOTION_MS);
      return () => window.clearTimeout(timer);
    }
    const maxTimer = window.setTimeout(finish, MAX_DISPLAY_MS);
    const unsubscribeBle = bleTelemetryClient.subscribe((_payload, connected) => {
      if (connected && !bleReadyRef.current) {
        bleReadyRef.current = true;
        tryAdvance();
      }
    });
    const handleRadar = () => {
      if (!radarReadyRef.current) {
        radarReadyRef.current = true;
        tryAdvance();
      }
    };
    window.addEventListener("codeblack:radar-first-frame", handleRadar);
    const bleTimeout = window.setTimeout(() => {
      if (!bleReadyRef.current) {
        bleReadyRef.current = true;
        tryAdvance();
      }
    }, BLE_TIMEOUT_MS);
    const radarTimeout = window.setTimeout(() => {
      if (!radarReadyRef.current) {
        radarReadyRef.current = true;
        tryAdvance();
      }
    }, RADAR_TIMEOUT_MS);
    return () => {
      window.clearTimeout(maxTimer);
      window.clearTimeout(bleTimeout);
      window.clearTimeout(radarTimeout);
      unsubscribeBle();
      window.removeEventListener("codeblack:radar-first-frame", handleRadar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={exiting ? "cb-splash cb-splash--exiting" : "cb-splash"} role="presentation" onClick={finish}>
      <div className="cb-splash__ring" aria-hidden="true" />
      <img src={codeblackShield} alt="" className="cb-splash__logo" />
      <strong className="cb-splash__title">
        CODE BLACK <em>OPS</em>
      </strong>
      <span className="cb-splash__tagline">Situational Awareness</span>
      <div className="cb-splash__status">
        <span>{reducedMotion ? STAGE_MESSAGE.ready : STAGE_MESSAGE[stage]}</span>
        <div className="cb-splash__bar">
          <em />
        </div>
      </div>
      <div className="cb-splash__hint">Tap to enter</div>
    </div>
  );
}
