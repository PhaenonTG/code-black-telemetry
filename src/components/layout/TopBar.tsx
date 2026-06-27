import { useEffect, useState } from "react";
import { useStatus, useSystem, usePower } from "../../hooks/useTelemetry";
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

  const cpuWarn = (system?.cpuPercent ?? 0) > 80;
  const battWarn = (power?.mainBatteryV ?? 13) < 12.0;

  return (
    <div className="flex items-center justify-between px-4 h-10 bg-cb-panel border-b border-cb-border shrink-0">
      {/* Left: Brand */}
      <div className="flex items-center gap-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-cb-blue font-semibold">
          Code Black
        </span>
        <span className="text-cb-border">|</span>
        <span className="font-mono text-[11px] uppercase tracking-widest text-cb-secondary">
          Telemetry
        </span>
      </div>

      {/* Center: Clock */}
      <Clock />

      {/* Right: Status */}
      <div className="flex items-center gap-4">
        <StatusBadge online={status?.piOnline ?? false} label="PI" pulse />
        <span className="font-mono text-[11px] text-cb-secondary">
          UNIT-01
        </span>
        <span className={`font-mono text-[11px] font-semibold ${cpuWarn || battWarn ? "text-cb-amber" : "text-cb-green"}`}>
          {cpuWarn || battWarn ? "⚠ WARN" : "● NOMINAL"}
        </span>
      </div>
    </div>
  );
}
