interface StatusBadgeProps {
  online: boolean;
  label?: string;
  pulse?: boolean;
}

export function StatusBadge({ online, label, pulse = false }: StatusBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${online ? "bg-cb-green" : "bg-cb-red"} ${pulse && online ? "pulse" : ""}`} />
      {label && (
        <span className={`text-[11px] font-mono uppercase tracking-wide ${online ? "text-cb-secondary" : "text-cb-red"}`}>
          {label}
        </span>
      )}
    </span>
  );
}
