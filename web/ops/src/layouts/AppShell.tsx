import { useEffect, useState, type ReactNode } from "react"
import { useViewport } from "../hooks/useViewport"
import { browserLocationAdapter, type LocationState } from "../adapters"
import { Sidebar } from "./Sidebar"
import { BottomNav } from "./BottomNav"
import { StatusBar } from "./StatusBar"

const SIDEBAR_COLLAPSED_KEY = "codeblack.ops.sidebarCollapsed"

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1"
  } catch {
    return false
  }
}

function locationLabel(state: LocationState): string {
  switch (state.status) {
    case "ready": return `GPS ${state.lat.toFixed(3)}, ${state.lon.toFixed(3)}`
    case "denied": return "LOCATION DENIED"
    case "requesting": return "LOCATION REQUESTING"
    case "unavailable": return "LOCATION UNAVAILABLE"
  }
}

export function AppShell({ children }: { children: ReactNode }) {
  const viewport = useViewport()
  const [location, setLocation] = useState<LocationState>({ status: "requesting" })
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed)

  useEffect(() => {
    let cancelled = false
    void browserLocationAdapter.getCurrent().then((s) => { if (!cancelled) setLocation(s) })
    const unwatch = browserLocationAdapter.watch((s) => { if (!cancelled) setLocation(s) })
    return () => { cancelled = true; unwatch() }
  }, [])

  if (viewport === "phone") {
    return (
      <div className="shell shell--phone">
        <main className="shell__content">{children}</main>
        <BottomNav />
      </div>
    )
  }

  const collapsible = viewport === "desktop"
  const rail = viewport === "tablet" || (collapsible && collapsed)
  const toggleCollapsed = () => {
    setCollapsed((value) => {
      const next = !value
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0") } catch { /* private browsing etc -- collapse still works this session */ }
      return next
    })
  }
  return (
    <div className={rail ? "shell shell--tablet" : "shell shell--desktop"}>
      <Sidebar rail={rail} collapsible={collapsible} onToggleCollapse={collapsible ? toggleCollapsed : undefined} />
      <div className="shell__main">
        <StatusBar locationLabel={locationLabel(location)} />
        <main className="shell__content">{children}</main>
      </div>
    </div>
  )
}
