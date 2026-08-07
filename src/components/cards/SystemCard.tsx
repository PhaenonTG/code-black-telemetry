import { memo } from "react";
import { useStatus, useSystem } from "../../hooks/useTelemetry";
import { ageLabel } from "../../services/telemetry/quality";
import { DashCard } from "../ui/DashCard";
import { MetricRow } from "../ui/MetricRow";
import { SourceBadge } from "../ui/SourceBadge";

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

export const SystemCard = memo(function SystemCard({ className }: { className?: string }) {
  const sys = useSystem();
  const status = useStatus();
  if (!sys) return null;
  const known = sys.source !== "unavailable";
  const live = status?.piOnline ?? false;

  return (
    <DashCard title="Pi System" className={className}>
      {!live && (
        <SourceBadge state={known ? "fallback" : "offline"}>
          {known ? `LAST KNOWN · ${ageLabel(sys.updatedAt)}` : "NO DATA EVER RECEIVED"}
        </SourceBadge>
      )}
      <MetricRow label="CPU"     value={known ? `${sys.cpuPercent.toFixed(0)}%` : "--"}     status={known ? pctStatus(sys.cpuPercent) : "muted"} />
      <MetricRow label="RAM"     value={known ? `${sys.ramPercent.toFixed(0)}%` : "--"}     status={known ? pctStatus(sys.ramPercent) : "muted"} />
      <MetricRow label="Storage" value={known ? `${sys.storagePercent.toFixed(0)}%` : "--"} status={known ? pctStatus(sys.storagePercent) : "muted"} />
      <MetricRow label="Uptime"  value={known ? uptime(sys.uptimeSeconds) : "--"} status="muted" />
    </DashCard>
  );
});
