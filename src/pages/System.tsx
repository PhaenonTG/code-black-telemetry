import { useSystem, usePower } from "../hooks/useTelemetry";
import { DashCard } from "../components/ui/DashCard";
import { MetricRow } from "../components/ui/MetricRow";
import { SensorHealthCard } from "../components/cards/SensorHealthCard";
import { EventsCard } from "../components/cards/EventsCard";

function pct(v: number): "ok" | "warn" | "critical" {
  if (v > 90) return "critical";
  if (v > 75) return "warn";
  return "ok";
}

function battStatus(v: number): "ok" | "warn" | "critical" {
  if (v < 11.8) return "critical";
  if (v < 12.2) return "warn";
  return "ok";
}

function uptime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${h}h ${m}m ${ss}s`;
}

export function System() {
  const sys    = useSystem();
  const power  = usePower();

  if (!sys || !power) return null;

  return (
    <div className="cb-scroll flex-1 p-4 grid gap-4" style={{ gridTemplateColumns: "1fr 1fr 1fr", alignContent: "start" }}>
      <DashCard title="Compute">
        <MetricRow label="CPU"     value={`${sys.cpuPercent.toFixed(1)}%`}     status={pct(sys.cpuPercent)} />
        <MetricRow label="RAM"     value={`${sys.ramPercent.toFixed(1)}%`}     status={pct(sys.ramPercent)} />
        <MetricRow label="Storage" value={`${sys.storagePercent.toFixed(1)}%`} status={pct(sys.storagePercent)} />
        <MetricRow label="Uptime"  value={uptime(sys.uptimeSeconds)} status="muted" />
      </DashCard>

      <DashCard title="Power">
        <MetricRow label="Main Batt" value={power.mainBatteryV.toFixed(3)} unit="V" status={battStatus(power.mainBatteryV)} />
        <MetricRow label="Aux Batt"  value={power.auxBatteryV.toFixed(3)}  unit="V" status={battStatus(power.auxBatteryV)} />
        <MetricRow label="Charging"  value={power.charging ? "YES" : "NO"} status={power.charging ? "ok" : "muted"} />
      </DashCard>

      <SensorHealthCard />

      <EventsCard className="col-span-3" />
    </div>
  );
}
