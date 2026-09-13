interface MetricRowProps {
  label: string;
  value: string | number;
  unit?: string;
  status?: "ok" | "warn" | "critical" | "muted";
}

const statusColor: Record<string, string> = {
  ok:       "text-white",
  warn:     "text-cb-amber",
  critical: "text-cb-red",
  muted:    "text-cb-muted",
};

export function MetricRow({ label, value, unit, status = "ok" }: MetricRowProps) {
  return (
    <div className="metric-row">
      <span>
        {label}
      </span>
      <strong className={statusColor[status]}>
        {value}
        {unit && <em>{unit}</em>}
      </strong>
    </div>
  );
}
