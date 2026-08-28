import type { ReactNode } from "react";

interface DashboardCardProps {
  title: string;
  meta?: string;
  children: ReactNode;
  className?: string;
}

export function DashboardCard({ title, meta, children, className = "" }: DashboardCardProps) {
  return (
    <section className={`dashboard-card ${className}`} aria-label={title}>
      <div className="card-header">
        <h2>{title}</h2>
        {meta && <span>{meta}</span>}
      </div>
      {children}
    </section>
  );
}
