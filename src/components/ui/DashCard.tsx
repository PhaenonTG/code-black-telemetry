interface DashCardProps {
  title: string;
  children: React.ReactNode;
  className?: string;
}

export function DashCard({ title, children, className = "" }: DashCardProps) {
  return (
    <div className={`cb-panel ${className}`}>
      <div className="cb-panel__title">
        <span className="panel-glyph" aria-hidden="true" />{title}
      </div>
      <div className="dash-card-body">
        {children}
      </div>
    </div>
  );
}
