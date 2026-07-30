interface DashCardProps {
  title: string;
  children: React.ReactNode;
  className?: string;
  accent?: boolean;
}

export function DashCard({ title, children, className = "", accent = false }: DashCardProps) {
  return (
    <div className={`cb-panel ${accent ? "cb-panel--spc" : ""} ${className}`}>
      <div className="cb-panel__title">
        <span className="panel-glyph" aria-hidden="true" />{title}
      </div>
      <div className="dash-card-body">
        {children}
      </div>
    </div>
  );
}
