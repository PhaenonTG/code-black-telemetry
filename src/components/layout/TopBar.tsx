import { useEffect, useState } from "react";
import { useGps, usePower, useStatus, useSystem } from "../../hooks/useTelemetry";
import { StatusBadge } from "../ui/StatusBadge";

function Clock() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="font-mono text-sm tabular-nums text-white">
      {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
    </span>
  );
}

export function TopBar() {
  const status = useStatus();
  const system = useSystem();
  const power = usePower();
  const gps = useGps();

  const cpuWarn = (system?.cpuPercent ?? 0) > 80;
  const battWarn = (power?.mainBatteryV ?? 13) < 12.0;
  const gpsSource = gps?.source === "tablet" ? "Tablet GPS" : gps?.source === "vehicle" || gps?.source === "esp" ? "Pi GPS" : gps?.source === "last-known" ? "Last Known GPS" : "GPS Acquiring";
  const gpsQuality = gps?.hasFix && gps.source !== "unavailable" && gps.source !== "simulator" ? `${gps.satellites ?? "--"} sats` : "No fix";
  const validGps = Boolean(gps?.hasFix && gps.source !== "unavailable" && gps.source !== "simulator" && Math.abs(gps.lat) <= 90 && Math.abs(gps.lon) <= 180 && !(gps.lat === 0 && gps.lon === 0));

  return (
    <header className="ops-header">
      <div className="brand-lockup" aria-label="Code Black OPS">
        <span className="brand-mark" aria-hidden="true" />
        <div>
          <div className="brand-title"><span>Code Black</span> <strong>OPS</strong></div>
          <div className="brand-subtitle">Situational Awareness</div>
        </div>
      </div>

      <div className="time-module">
        <Clock />
        <span>Local Time</span>
      </div>

      <div className="header-status">
        <div className="gps-strip">
          <span className="gps-crosshair" aria-hidden="true" />
          <span>{gpsSource}</span>
          <strong>{gpsQuality}</strong>
          <em>{gps?.accuracyM != null ? `${Math.round(gps.accuracyM)} m` : "-- m"}</em>
        </div>
        <div className="unit-strip">
          <StatusBadge online={status?.piOnline ?? false} label="PI" pulse />
          <span>UNIT-01</span>
          <strong className={cpuWarn || battWarn ? "is-warn" : "is-ok"}>{cpuWarn || battWarn ? "WARN" : "NOMINAL"}</strong>
          <em>{validGps && gps ? `${gps.lat.toFixed(5)} N  ${Math.abs(gps.lon).toFixed(5)} W` : "--"}</em>
        </div>
      </div>
    </header>
  );
}
