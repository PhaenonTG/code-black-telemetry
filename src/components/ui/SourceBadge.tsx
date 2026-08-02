export function SourceBadge({ children, state }: { children: React.ReactNode; state?: string }) {
  return <span className={`cb-badge ${state ? `cb-badge--${state.toLowerCase()}` : ""}`}>{children}</span>;
}
