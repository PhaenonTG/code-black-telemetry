import type { ReactNode } from "react"
import { routeForPath, routeEyebrow } from "../app/routes"

export function PageHeader({ title, kicker, description, actions, className, routePath }: { title: string; kicker?: string; description?: ReactNode; actions?: ReactNode; className?: string; routePath?: string }) {
  const route = routeForPath(routePath ?? (title === "STATUS CENTER" ? "/status" : title === "Automation Lab" ? "/automation-lab" : ""))
  title = route?.label ?? title
  kicker = route ? routeEyebrow(route) : kicker
  return (
    <header className={className ? `page-header ${className}` : "page-header"}>
      <div>
        {kicker && <p className="page-header__kicker">{kicker}</p>}
        <h1>{title}</h1>
        {description && <p className="page-header__description">{description}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  )
}
