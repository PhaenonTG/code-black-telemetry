interface DashCardProps {
  title: string;
  children: React.ReactNode;
  className?: string;
  accent?: boolean;
}

export function DashCard({ title, children, className = "", accent = false }: DashCardProps) {
  return (
    <div className={`flex flex-col bg-cb-panel border ${accent ? "border-cb-blue/30" : "border-cb-border"} rounded-sm overflow-hidden ${className}`}>
      <div className={`px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest ${accent ? "text-cb-blue" : "text-cb-muted"} border-b border-cb-border`}>
        {title}
      </div>
      <div className="flex-1 p-3">
        {children}
      </div>
    </div>
  );
}
