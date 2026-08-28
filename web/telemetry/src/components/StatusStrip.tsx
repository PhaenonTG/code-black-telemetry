import type { TelemetrySnapshot } from "../telemetry/types";
import { fixed } from "../utils/format";

export function StatusStrip({ snapshot }: { snapshot: TelemetrySnapshot }) {
  const items = [
    ["API latency", `${Math.round(snapshot.status.apiLatencyMs)} ms`],
    ["Data age", `${snapshot.status.dataAgeSeconds}s`],
    ["Pi online", snapshot.status.piOnline ? "YES" : "NO"],
    ["CPU", `${fixed(snapshot.system.cpuPercent)}%`],
    ["Memory", `${fixed(snapshot.system.memoryPercent)}%`],
    ["Battery", `${fixed(snapshot.power.mainBatteryV, 2)} V`],
  ];

  return (
    <section className="status-strip" aria-label="System status strip">
      {items.map(([label, value]) => (
        <div className="strip-item" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </section>
  );
}
