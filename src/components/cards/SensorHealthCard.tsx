import { useSensors } from "../../hooks/useTelemetry";
import { DashCard } from "../ui/DashCard";
import { StatusBadge } from "../ui/StatusBadge";

export function SensorHealthCard({ className }: { className?: string }) {
  const sensors = useSensors();
  if (!sensors) return null;

  return (
    <DashCard title="Sensor Health" className={className}>
      <div className="flex flex-col gap-3">
        {sensors.map(sensor => {
          const age = Math.round((Date.now() - sensor.lastPacketAt) / 1000);
          return (
            <div key={sensor.id} className="flex items-center justify-between">
              <StatusBadge online={sensor.online} label={sensor.label} pulse={sensor.online} />
              <div className="text-right">
                <div className="font-mono text-[11px] text-cb-secondary tabular-nums">
                  {sensor.packetRateHz.toFixed(1)} Hz
                </div>
                <div className="font-mono text-[10px] text-cb-muted tabular-nums">
                  {age}s ago
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </DashCard>
  );
}
