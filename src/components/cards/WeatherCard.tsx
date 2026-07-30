import { useWeather } from "../../hooks/useTelemetry";
import { valueText } from "../../services/telemetry/quality";
import { DashCard } from "../ui/DashCard";
import { MetricRow } from "../ui/MetricRow";

export function WeatherCard({ className }: { className?: string }) {
  const wx = useWeather();
  if (!wx) return null;

  const humidWarn = (wx.humidity ?? 0) > 85;

  return (
    <DashCard title="Weather" className={className}>
      <div className="flex items-end gap-3 mb-3">
        <div>
          <span className="font-mono text-4xl font-bold text-white tabular-nums">{valueText(wx.tempF, 1)}</span>
          <span className="text-cb-muted text-xs ml-1 font-mono">deg F</span>
        </div>
      </div>
      <MetricRow label="Dewpoint" value={valueText(wx.dewpointF, 1)} unit="deg F" />
      <MetricRow label="Humidity" value={`${valueText(wx.humidity, 0)}%`} status={humidWarn ? "warn" : "ok"} />
    </DashCard>
  );
}
