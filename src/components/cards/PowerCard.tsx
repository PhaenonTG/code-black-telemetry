import { memo } from "react";
import { usePower, useStatus } from "../../hooks/useTelemetry";
import { ageLabel } from "../../services/telemetry/quality";
import { DashCard } from "../ui/DashCard";
import { MetricRow } from "../ui/MetricRow";
import { SourceBadge } from "../ui/SourceBadge";

function battStatus(v: number): "ok" | "warn" | "critical" {
  if (v < 11.8) return "critical";
  if (v < 12.2) return "warn";
  return "ok";
}

export const PowerCard = memo(function PowerCard({ className }: { className?: string }) {
  const power = usePower();
  const status = useStatus();
  if (!power) return null;
  const known = power.source !== "unavailable";
  const live = status?.piOnline ?? false;
  const mainKnown = known && power.mainBatteryV !== null;
  const auxKnown = known && power.auxBatteryV !== null;
  const chargingKnown = known && power.charging !== null;

  return (
    <DashCard title="Vehicle Power" className={className}>
      {!live && (
        <SourceBadge state={known ? "fallback" : "offline"}>
          {known ? `LAST KNOWN · ${ageLabel(power.updatedAt)}` : "NO DATA EVER RECEIVED"}
        </SourceBadge>
      )}
      <MetricRow label="Main Batt" value={mainKnown ? power.mainBatteryV!.toFixed(2) : "--"} unit={mainKnown ? "V" : undefined} status={mainKnown ? battStatus(power.mainBatteryV!) : "muted"} />
      <MetricRow label="Aux Batt" value={auxKnown ? power.auxBatteryV!.toFixed(2) : "--"} unit={auxKnown ? "V" : undefined} status={auxKnown ? battStatus(power.auxBatteryV!) : "muted"} />
      <MetricRow label="Charging" value={chargingKnown ? (power.charging ? "YES" : "NO") : "--"} status={chargingKnown && power.charging ? "ok" : "muted"} />
    </DashCard>
  );
});
