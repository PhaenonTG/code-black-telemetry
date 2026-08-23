import { memo } from "react";
import { useSensors, useStatus } from "../../hooks/useTelemetry";
import { formatOperationalAge, observationStateFromTimestamp } from "../../services/operationalStatus";
import { DashCard } from "../ui/DashCard";
import { StatusBadge } from "../ui/StatusBadge";

export const SensorHealthCard = memo(function SensorHealthCard({ className }: { className?: string }) {
  const sensors = useSensors();
  const status = useStatus();
  if (!sensors) return null;

  return (
    <DashCard title="Sensor Health" className={className}>
      <div className="flex flex-col gap-3">
        {sensors.length === 0 && <div className="calm-card">NO SENSORS REPORTED</div>}
        {sensors.map(sensor => {
          const packetState = observationStateFromTimestamp(sensor.lastPacketAt ?? null, Date.now(), {
            agingMs: 15_000,
            staleMs: 90_000,
            offlineMs: 5 * 60_000,
          });
          const live = Boolean(sensor.online && status?.piOnline && (packetState === "LIVE" || packetState === "AGING"));
          const summary = !status?.connection?.isConfigured
            ? "PI NOT CONFIGURED"
            : packetState === "NO_DATA"
              ? "NO PACKETS"
              : packetState;
          return (
            <div key={sensor.id} className="flex items-center justify-between">
              <StatusBadge online={live} label={sensor.label} pulse={live} />
              <div className="text-right">
                <div className="font-mono text-[11px] text-cb-secondary tabular-nums">
                  {live ? `${sensor.packetRateHz.toFixed(1)} Hz` : summary}
                </div>
                <div className="font-mono text-[10px] text-cb-muted tabular-nums">
                  {sensor.lastPacketAt ? formatOperationalAge(sensor.lastPacketAt) : "NO DATA"}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </DashCard>
  );
});
