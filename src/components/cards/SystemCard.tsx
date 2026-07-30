import { useStatus, useSystem } from "../../hooks/useTelemetry";
import { DashCard } from "../ui/DashCard";
import { MetricRow } from "../ui/MetricRow";

function pctStatus(v: number): "ok" | "warn" | "critical" {
  if (v > 90) return "critical";
  if (v > 75) return "warn";
  return "ok";
}

function uptime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

export function SystemCard({ className }: { className?: string }) {
  const sys = useSystem();
  const status = useStatus();
  if (!sys) return null;
  if (!status?.piOnline) {
    return (
      <DashCard title="Pi System" className={className}>
        <div className="cb-empty cb-empty--compact">NO LIVE PI SYSTEM DATA</div>
      </DashCard>
    );
  }

  return (
    <DashCard title="Pi System" className={className}>
      <MetricRow label="CPU"     value={`${sys.cpuPercent.toFixed(0)}%`}     status={pctStatus(sys.cpuPercent)} />
      <MetricRow label="RAM"     value={`${sys.ramPercent.toFixed(0)}%`}     status={pctStatus(sys.ramPercent)} />
      <MetricRow label="Storage" value={`${sys.storagePercent.toFixed(0)}%`} status={pctStatus(sys.storagePercent)} />
      <MetricRow label="Uptime"  value={uptime(sys.uptimeSeconds)} status="muted" />
    </DashCard>
  );
}
