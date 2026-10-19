export function SourceBadge({ children, state, className }: { children: React.ReactNode; state?: string; className?: string }) {
  return <span className={`cb-badge ${state ? `cb-badge--${state.toLowerCase()}` : ""}${className ? ` ${className}` : ""}`}>{children}</span>;
}
