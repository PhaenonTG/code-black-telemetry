import { usePower, useStatus } from "../../hooks/useTelemetry";
import { DashCard } from "../ui/DashCard";
import { MetricRow } from "../ui/MetricRow";

function battStatus(v: number): "ok" | "warn" | "critical" {
  if (v < 11.8) return "critical";
  if (v < 12.2) return "warn";
  return "ok";
}

export function PowerCard({ className }: { className?: string }) {
  const power = usePower();
  const status = useStatus();
  if (!power) return null;
  if (!status?.piOnline) {
    return (
      <DashCard title="Vehicle Power" className={className}>
        <div className="cb-empty cb-empty--compact">NO LIVE VEHICLE POWER DATA</div>
      </DashCard>
    );
  }

  return (
    <DashCard title="Vehicle Power" className={className}>
      <MetricRow label="Main Batt"  value={power.mainBatteryV.toFixed(2)} unit="V" status={battStatus(power.mainBatteryV)} />
      <MetricRow label="Aux Batt"   value={power.auxBatteryV.toFixed(2)}  unit="V" status={battStatus(power.auxBatteryV)} />
      <MetricRow label="Charging"   value={power.charging ? "YES" : "NO"} status={power.charging ? "ok" : "muted"} />
    </DashCard>
  );
}
