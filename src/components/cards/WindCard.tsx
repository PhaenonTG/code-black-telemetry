import { useWind } from "../../hooks/useTelemetry";
import { cardinalFromDeg, valueText } from "../../services/telemetry/quality";
import { DashCard } from "../ui/DashCard";
import { MetricRow } from "../ui/MetricRow";

function windStatus(mph: number): "ok" | "warn" | "critical" {
  if (mph > 50) return "critical";
  if (mph > 30) return "warn";
  return "ok";
}

export function WindCard({ className }: { className?: string }) {
  const wind = useWind();
  if (!wind) return null;

  const age = Math.round((Date.now() - wind.updatedAt) / 1000);
  const cardinal = wind.directionCardinal || cardinalFromDeg(wind.directionDeg);

  return (
    <DashCard title="Wind" className={className}>
      <div className="flex items-end gap-4 mb-3">
        <div>
          <span className="font-mono text-4xl font-bold text-white tabular-nums">{valueText(wind.speedMph, 1)}</span>
          <span className="text-cb-muted text-xs ml-1 font-mono">mph</span>
        </div>
        <div className="mb-1">
          <span className="font-mono text-xl font-semibold text-cb-blue">{cardinal}</span>
          <span className="text-cb-muted text-xs ml-1 font-mono">{valueText(wind.directionDeg, 0)} deg</span>
        </div>
      </div>
      <MetricRow label="Gust" value={valueText(wind.gustMph, 1)} unit="mph" status={windStatus(wind.gustMph ?? 0)} />
      <MetricRow label="Direction" value={`${valueText(wind.directionDeg, 0)} deg ${cardinal}`} />
      <MetricRow label="Fresh" value={age < 5 ? "LIVE" : `${age}s ago`} status={age > 30 ? "warn" : "ok"} />
    </DashCard>
  );
}
