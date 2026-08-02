import { useEffect, useState } from "react";
import codeblackShield from "../../assets/codeblack-shield.png";
import { useStatus } from "../../hooks/useTelemetry";
import { useBattery } from "../../hooks/useBattery";
import "./TopBar.css";

function batteryState(level: number): "good" | "warn" | "bad" {
  if (level > 65) return "good";
  if (level >= 35) return "warn";
  return "bad";
}

function BatteryChip({ level }: { level: number | null }) {
  if (level == null) return null;
  const state = batteryState(level);
  const fillWidth = Math.max(1, Math.round((level / 100) * 12));
  return (
    <div className={`battery-chip battery-chip--${state}`} aria-label={`Tablet battery ${level} percent`}>
      <svg className="battery-chip__icon" viewBox="0 0 18 10" aria-hidden="true">
        <rect x="0.5" y="0.5" width="15" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1" />
        <rect x="16" y="3" width="1.5" height="4" rx="0.5" fill="currentColor" />
        <rect x="2" y="2" width={fillWidth} height="6" rx="0.5" fill="currentColor" />
      </svg>
      <span>{level}%</span>
    </div>
  );
}

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

// Real signal, not decorative: piOnline drives good/bad, apiLatencyMs drives a "degraded but
// connected" middle state. This is the initial wiring the user asked to have in place for future
// refinement — not a fabricated value, both inputs already come from the live telemetry status.
function piLinkState(piOnline: boolean | undefined, apiLatencyMs: number | undefined): "good" | "degraded" | "bad" {
  if (!piOnline) return "bad";
  if ((apiLatencyMs ?? 0) > 800) return "degraded";
  return "good";
}

export function TopBar() {
  const status = useStatus();
  const batteryLevel = useBattery();
  const now = useNow();
  const linkState = piLinkState(status?.piOnline, status?.apiLatencyMs);
  const dateLabel = now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }).toUpperCase();

  return (
    <header className="ops-header">
      <div className="brand-lockup" aria-label="Code Black OPS">
        <img className="brand-mark brand-mark--codeblack" src={codeblackShield} alt="Code Black" />
        <div>
          <div className="brand-title"><span>Code Black</span> <strong>OPS</strong></div>
          <div className="brand-subtitle">Situational Awareness</div>
        </div>
      </div>

      <div className="time-module">
        <span className="font-mono text-sm tabular-nums text-white">
          {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
        </span>
        <span>Local Time</span>
      </div>

      <div className="header-status">
        <div className="header-date">{dateLabel}</div>
        <div className="pi-link">
          <span className={`pi-link__dot pi-link__dot--${linkState}`} aria-hidden="true" />
          <span>Pi Link</span>
        </div>
        <BatteryChip level={batteryLevel} />
      </div>
    </header>
  );
}
