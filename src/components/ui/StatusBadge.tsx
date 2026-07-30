interface StatusBadgeProps {
  online: boolean;
  label?: string;
  pulse?: boolean;
}

export function StatusBadge({ online, label, pulse = false }: StatusBadgeProps) {
  return (
    <span className={`status-badge ${online ? "status-badge--online" : "status-badge--offline"}`}>
      <span className={`status-badge__dot ${pulse && online ? "pulse" : ""}`} />
      {label && (
        <span>
          {label}
        </span>
      )}
    </span>
  );
}
