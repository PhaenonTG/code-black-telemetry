import { useWeather } from "../hooks/useTelemetry";
import { DashCard } from "../components/ui/DashCard";
import { MetricRow } from "../components/ui/MetricRow";

export function Weather() {
  const wx = useWeather();
  if (!wx) return null;

  return (
    <div className="cb-scroll flex-1 p-4 grid gap-4" style={{ gridTemplateColumns: "1fr 1fr 1fr", alignContent: "start" }}>
      <DashCard title="Temperature" accent>
        <div className="flex flex-col items-center justify-center py-4">
          <span className="font-mono text-7xl font-bold text-white tabular-nums">
            {wx.tempF.toFixed(1)}
          </span>
          <span className="text-cb-muted font-mono text-sm mt-1">°F</span>
        </div>
      </DashCard>

      <DashCard title="Dewpoint" accent>
        <div className="flex flex-col items-center justify-center py-4">
          <span className="font-mono text-7xl font-bold text-white tabular-nums">
            {wx.dewpointF.toFixed(1)}
          </span>
          <span className="text-cb-muted font-mono text-sm mt-1">°F</span>
        </div>
      </DashCard>

      <DashCard title="Humidity" accent>
        <div className="flex flex-col items-center justify-center py-4">
          <span className={`font-mono text-7xl font-bold tabular-nums ${wx.humidity > 85 ? "text-cb-amber" : "text-white"}`}>
            {wx.humidity.toFixed(0)}
          </span>
          <span className="text-cb-muted font-mono text-sm mt-1">%</span>
        </div>
      </DashCard>

      <DashCard title="All Readings" className="col-span-3">
        <MetricRow label="Temperature" value={wx.tempF.toFixed(2)}      unit="°F" />
        <MetricRow label="Dewpoint"    value={wx.dewpointF.toFixed(2)}  unit="°F" />
        <MetricRow label="Humidity"    value={`${wx.humidity.toFixed(1)}%`} status={wx.humidity > 85 ? "warn" : "ok"} />
        <MetricRow label="Spread"      value={(wx.tempF - wx.dewpointF).toFixed(2)} unit="°F" status="muted" />
      </DashCard>
    </div>
  );
}
