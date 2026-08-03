import { useEffect, useRef, useState } from "react";
import { subscribeSevereFlash } from "../services/severeFlash";
import type { AlertProduct } from "../services/situational";

const AUTO_DISMISS_MS = 5_000;

export function SevereFlashOverlay() {
  const [alert, setAlert] = useState<AlertProduct | null>(null);
  const dismissTimer = useRef<number | null>(null);

  useEffect(() => {
    return subscribeSevereFlash((next) => {
      setAlert(next);
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
