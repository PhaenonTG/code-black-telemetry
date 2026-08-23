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
  const cpuKnown = known && sys.cpuPercent !== null;
  const ramKnown = known && sys.ramPercent !== null;
  const storageKnown = known && sys.storagePercent !== null;
  const uptimeKnown = known && sys.uptimeSeconds !== null;

  return (
    <DashCard title="Pi System" className={className}>
      {!live && (
        <SourceBadge state={known ? "fallback" : "offline"}>
          {known ? `LAST KNOWN · ${ageLabel(sys.updatedAt)}` : "NO DATA EVER RECEIVED"}
        </SourceBadge>
      )}
      <MetricRow label="CPU" value={cpuKnown ? `${sys.cpuPercent!.toFixed(0)}%` : "--"} status={cpuKnown ? pctStatus(sys.cpuPercent!) : "muted"} />
      <MetricRow label="RAM" value={ramKnown ? `${sys.ramPercent!.toFixed(0)}%` : "--"} status={ramKnown ? pctStatus(sys.ramPercent!) : "muted"} />
      <MetricRow label="Storage" value={storageKnown ? `${sys.storagePercent!.toFixed(0)}%` : "--"} status={storageKnown ? pctStatus(sys.storagePercent!) : "muted"} />
      <MetricRow label="Uptime" value={uptimeKnown ? uptime(sys.uptimeSeconds!) : "--"} status="muted" />
    </DashCard>
  );
});
