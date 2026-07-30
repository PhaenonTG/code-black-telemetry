import { useSensors, useStatus } from "../../hooks/useTelemetry";
import { DashCard } from "../ui/DashCard";
import { StatusBadge } from "../ui/StatusBadge";

export function SensorHealthCard({ className }: { className?: string }) {
  const sensors = useSensors();
  const status = useStatus();
  if (!sensors) return null;

  return (
    <DashCard title="Sensor Health" className={className}>
      <div className="flex flex-col gap-3">
        {sensors.map(sensor => {
          const online = status?.piOnline && sensor.online;
          const age = sensor.lastPacketAt ? Math.round((Date.now() - sensor.lastPacketAt) / 1000) : null;
          return (
            <div key={sensor.id} className="flex items-center justify-between">
              <StatusBadge online={Boolean(online)} label={sensor.label} pulse={Boolean(online)} />
              <div className="text-right">
                <div className="font-mono text-[11px] text-cb-secondary tabular-nums">
                  {online ? `${sensor.packetRateHz.toFixed(1)} Hz` : "VIA PI · OFFLINE"}
                </div>
                <div className="font-mono text-[10px] text-cb-muted tabular-nums">
                  {age === null ? "NO PACKETS" : `${age}s ago`}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </DashCard>
  );
}
