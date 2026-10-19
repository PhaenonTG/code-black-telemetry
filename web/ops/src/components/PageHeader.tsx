import type { ReactNode } from "react"

export function PageHeader({ title, kicker, description, actions }: { title: string; kicker?: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        {kicker && <p className="page-header__kicker">{kicker}</p>}
        <h1>{title}</h1>
        {description && <p className="page-header__description">{description}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  )
}
