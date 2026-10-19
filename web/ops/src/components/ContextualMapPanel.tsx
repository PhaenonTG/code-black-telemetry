import { useEffect, useRef, useState, type ReactNode } from "react"
import "./ContextualMapPanel.css"

/** Page layout only: keep the existing map mounted, controls and data ownership intact. */
export function ContextualMapPanel({ title, children, context, disabled = false, legacyClassName = "" }: {
  title: string; children: ReactNode; context: ReactNode; disabled?: boolean; legacyClassName?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const mapArea = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (disabled || !mapArea.current) return
    let pending = 0
    const notify = () => {
      cancelAnimationFrame(pending)
      pending = requestAnimationFrame(() => window.dispatchEvent(new Event("resize")))
    }
    // Mapbox's existing trackResize listener handles the new containing dimensions.
    const observer = new ResizeObserver(notify)
    observer.observe(mapArea.current)
    return () => { observer.disconnect(); cancelAnimationFrame(pending) }
  }, [disabled])
  useEffect(() => {
    if (!expanded) return
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setExpanded(false); toggle.current?.focus() }
    }
    window.addEventListener("keydown", escape)
    return () => window.removeEventListener("keydown", escape)
  }, [expanded])
  if (disabled) return <div className={legacyClassName}>{children}{context}</div>
  return <section className="context-map-panel" data-expanded={expanded} aria-label={title}>
    <header className="context-map-panel__header">
      <h2>{title}</h2>
      <button ref={toggle} type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        {expanded ? "Restore contextual view" : "Expand map"}
      </button>
    </header>
    <div className="context-map-panel__grid">
      <div ref={mapArea} className="context-map-panel__map">{children}</div>
      <aside className="context-map-panel__context" aria-label={`${title} context`}>{context}</aside>
    </div>
  </section>
}
