interface MetricProps {
  label: string;
  value: string;
  unit?: string;
  tone?: "normal" | "accent" | "warning" | "critical" | "muted";
}

export function Metric({ label, value, unit, tone = "normal" }: MetricProps) {
  return (
    <div className="metric" data-tone={tone}>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">
        {value}
        {unit && <small>{unit}</small>}
      </strong>
    </div>
  );
}
