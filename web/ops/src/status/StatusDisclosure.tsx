import { useState, type ReactNode } from "react"

/** Keep native keyboard behavior and avoid mounting heavy diagnostics until opened. */
export function StatusDisclosure({ title, children, className = "", label }: {
  title: ReactNode; children: ReactNode; className?: string; label?: string
}) {
  const [open, setOpen] = useState(false)
  return <details className={`status-disclosure ${className}`} aria-label={label}
    onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{title}<span className="status-disclosure__chevron" aria-hidden="true">⌄</span></summary>
    {open && <div className="status-disclosure__body">{children}</div>}
  </details>
}
