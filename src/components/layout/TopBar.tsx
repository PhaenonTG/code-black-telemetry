import { useEffect, useState } from "react";
import codeblackShield from "../../assets/codeblack-shield.png";
import { useStatus } from "../../hooks/useTelemetry";
import { useBattery } from "../../hooks/useBattery";
import { useNearbyStormThreats } from "../../hooks/useNearbyStormThreats";
import { computeThreatHero } from "../../hooks/useThreatHero";
import type { SpcDayOutlook } from "../../services/spcOutlook";
import { formatOpsClock } from "../../services/clock";
import { loadClockMode, subscribeClockMode, type ClockMode } from "../../services/settings";
import "./TopBar.css";

function batteryState(level: number): "good" | "warn" | "bad" {
  if (level > 65) return "good";
  if (level >= 35) return "warn";
  return "bad";
}

function BatteryChip({ level, isCharging, label }: { level: number | null; isCharging: boolean; label: string }) {
  if (level == null) return null;
  const state = batteryState(level);
  const fillWidth = Math.max(1, Math.round((level / 100) * 12));
  return (
    <div className={`battery-chip battery-chip--${state}`} aria-label={`${label} ${level} percent${isCharging ? ", charging" : ""}`}>
      {isCharging && (
        <svg className="battery-chip__bolt" viewBox="0 0 10 14" aria-hidden="true">
          <path d="M5.6 0 0 8h3.4L2.6 14 9 5H5.4Z" fill="currentColor" />
        </svg>
      )}
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
function piLinkState(status: ReturnType<typeof useStatus> | undefined | null): "good" | "degraded" | "bad" {
  const connectionState = status?.connection?.connectionState;
  if (connectionState === "STALE" || connectionState === "DEGRADED" || connectionState === "CONNECTING") return "degraded";
  if (connectionState === "NOT_CONFIGURED" || connectionState === "DISCONNECTED" || connectionState === "ERROR") return "bad";
  const piOnline = status?.piOnline;
  const apiLatencyMs = status?.apiLatencyMs;
  if (!piOnline) return "bad";
  if ((apiLatencyMs ?? 0) > 800) return "degraded";
  return "good";
}

export function TopBar({
  batteryLabel = "Device battery",
  gps = null,
  outlooks = [],
}: {
  batteryLabel?: string;
  gps?: { lat: number; lon: number } | null;
  outlooks?: SpcDayOutlook[];
}) {
  const status = useStatus();
  const battery = useBattery();
  const now = useNow();
  const [clockMode, setClockMode] = useState<ClockMode>("local");
  const linkState = piLinkState(status);
  const dateLabel = now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }).toUpperCase();
  const clock = formatOpsClock(now, clockMode);
  // Persistent across every page (this component mounts once at the app root), unlike the Home
  // hero band which only exists on Home -- the tablet dash-mount is meant to be glanced at from
  // Map/Weather/Operations too without navigating back to Home first. Tablet-only, see TopBar.css;
  // phone already gets this on Home and doesn't need a second copy competing for its small header.
  const { threats } = useNearbyStormThreats(gps);
  const day1Outlook = outlooks.find((o) => o.day === 1)?.categorical ?? null;
  const hero = computeThreatHero(threats[0] ?? null, day1Outlook);

  useEffect(() => {
    const unsubscribe = subscribeClockMode(setClockMode);
    void loadClockMode();
    const refresh = () => void loadClockMode();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("codeblack:resume", refresh);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("codeblack:resume", refresh);
    };
  }, []);

  return (
    // Single root element -- .app-shell is a CSS grid keyed to a fixed row layout of its direct
    // children (header row, content row, dock row). An earlier version of this returned a Fragment
    // with the header and the threat strip as two separate top-level siblings, which silently
    // inserted an extra grid item into .app-shell's flow and squeezed .page-viewport to 0 height
    // app-wide. Nest everything inside one <header> instead.
    <header className="ops-header-wrap">
      <div className="ops-header">
        <div className="brand-lockup" aria-label="Code Black OPS">
          {/* Owner wants the full shield badge here, not a cropped icon -- sized up from the earlier
              icon-only attempt so the shield outline and tornado mark actually read at a glance
              instead of aliasing into a smudge (see .brand-mark--codeblack in TopBar.css). */}
          <img className="brand-mark brand-mark--codeblack" src={codeblackShield} alt="Code Black" />
          <div>
            <div className="brand-title"><span>Code Black</span> <strong>OPS</strong></div>
            <div className="brand-subtitle">Situational Awareness</div>
          </div>
        </div>

        <div className="time-module">
          <span className="font-mono text-sm tabular-nums text-white">
            {clock.time}
          </span>
          <span>{clock.label} Time · {clock.zone}</span>
        </div>

        <div className="header-status">
          <div className="header-date">{dateLabel}</div>
          <div className="pi-link">
            <span className={`pi-link__dot pi-link__dot--${linkState}`} aria-hidden="true" />
            <span>Pi Link</span>
          </div>
          <BatteryChip level={battery.level} isCharging={battery.isCharging} label={batteryLabel} />
        </div>
      </div>
      <div className={`ops-header-threat ops-header-threat--${hero.tone}`} data-testid="header-threat-strip" aria-live="polite">
        <span className="ops-header-threat__pulse" aria-hidden="true" />
        <strong>{hero.label}</strong>
        <span className="ops-header-threat__sep">·</span>
        <span>{hero.detail}</span>
      </div>
    </header>
  );
}
