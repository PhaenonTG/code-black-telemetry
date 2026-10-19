import { Suspense, useEffect, useRef, useState, type ReactNode } from "react"
import { AsyncViewState } from "./AsyncViewState"
import { deferPanel } from "./deferPanel"

export function DeferredPanel({ children, title, minHeight }: { children: ReactNode; title: string; minHeight: number }) {
  const host = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!host.current || ready) return
    return deferPanel(host.current, () => setReady(true))
  }, [ready])
  const placeholder = <AsyncViewState state="loading" title={title} />
  return <div ref={host} className="deferred-panel" style={{ minHeight }}>
    {ready ? <Suspense fallback={placeholder}>{children}</Suspense> : <>{placeholder}<button type="button" onClick={() => setReady(true)}>Open {title}</button></>}
  </div>
}
