import { useStatus, useSystem, usePower } from "../../hooks/useTelemetry";

interface StripItemProps {
  label: string;
  value: string;
  warn?: boolean;
  critical?: boolean;
}

function StripItem({ label, value, warn, critical }: StripItemProps) {
  const color = critical ? "text-cb-red" : warn ? "text-cb-amber" : "text-cb-secondary";
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-cb-muted text-[10px] font-mono uppercase tracking-widest">{label}</span>
      <span className={`text-[11px] font-mono font-semibold tabular-nums ${color}`}>{value}</span>
    </span>
  );
}

export function StatusStrip() {
  const status = useStatus();
  const system = useSystem();
  const power  = usePower();

  const latency = status?.apiLatencyMs ?? 0;
  const age     = status?.dataAgeSeconds ?? 0;
  const cpu     = system?.cpuPercent ?? 0;
  const ram     = system?.ramPercent ?? 0;
  const mainV   = power?.mainBatteryV ?? 0;

  function uptime(s: number): string {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
  }

  return (
    <div className="flex items-center gap-5 px-4 h-7 bg-[#0F0F0F] border-b border-cb-border shrink-0 overflow-x-auto">
      <StripItem label="LATENCY" value={`${latency}ms`} warn={latency > 100} critical={latency > 300} />
      <span className="text-cb-border">·</span>
      <StripItem label="DATA AGE" value={`${age}s`} warn={age > 10} critical={age > 30} />
      <span className="text-cb-border">·</span>
      <StripItem label="PI" value={status?.piOnline ? "ONLINE" : "OFFLINE"} critical={!status?.piOnline} />
      <span className="text-cb-border">·</span>
      <StripItem label="CPU" value={`${cpu.toFixed(0)}%`} warn={cpu > 70} critical={cpu > 90} />
      <span className="text-cb-border">·</span>
      <StripItem label="RAM" value={`${ram.toFixed(0)}%`} warn={ram > 75} critical={ram > 90} />
      <span className="text-cb-border">·</span>
      <StripItem label="MAIN BATT" value={`${mainV.toFixed(2)}V`} warn={mainV < 12.2} critical={mainV < 11.8} />
      <span className="text-cb-border">·</span>
      <StripItem label="UPTIME" value={uptime(system?.uptimeSeconds ?? 0)} />
    </div>
  );
}
