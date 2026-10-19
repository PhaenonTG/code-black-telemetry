export function Panel({ title, children, className = "", tone = "default" }: { title: string; children: React.ReactNode; className?: string; tone?: "default" | "red" | "spc" }) {
  const toneClass = tone === "red" ? "cb-panel--red" : tone === "spc" ? "cb-panel--spc" : "";
  return (
    <section className={`cb-panel ${toneClass} ${className}`} data-tone={tone}>
      <div className="cb-panel__title"><span className="panel-glyph" aria-hidden="true" />{title}</div>
      {children}
    </section>
  );
}

export function MetricTile({ icon, label, value, unit, accent = "default", hero = false }: { icon?: string; label: string; value: React.ReactNode; unit?: React.ReactNode; accent?: "default" | "red" | "blue" | "amber" | "green"; hero?: boolean }) {
  const labelClass = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return (
    <div className={`metric-tile metric-tile--${accent} metric-tile--${labelClass}${hero ? " metric-tile--hero" : ""}`}>
      {icon && <i aria-hidden="true">{icon}</i>}
      <strong>{value}</strong>
      <span>{label}</span>
      {unit && <em>{unit}</em>}
    </div>
  );
}
