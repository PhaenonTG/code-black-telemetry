interface MetricRowProps {
  label: string;
  value: string | number;
  unit?: string;
  status?: "ok" | "warn" | "critical" | "muted";
  large?: boolean;
}

const statusColor: Record<string, string> = {
  ok:       "text-white",
  warn:     "text-cb-amber",
  critical: "text-cb-red",
  muted:    "text-cb-muted",
};

export function MetricRow({ label, value, unit, status = "ok", large = false }: MetricRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1 border-b border-cb-border/50 last:border-0">
      <span className="text-[11px] text-cb-secondary font-mono uppercase tracking-wide shrink-0">
        {label}
      </span>
      <span className={`font-mono ${large ? "text-2xl font-bold" : "text-sm font-semibold"} ${statusColor[status]} tabular-nums`}>
        {value}
        {unit && <span className="text-cb-muted text-[10px] ml-0.5 font-normal">{unit}</span>}
      </span>
    </div>
  );
}
