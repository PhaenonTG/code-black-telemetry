import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react"
import { useLocation } from "react-router-dom"
import { DeskProvider, useDesk } from "../desk/DeskProvider"
import { Sidebar } from "./Sidebar"
import { BottomNav } from "./BottomNav"
import { StatusBar } from "./StatusBar"
import { AegisSidecar } from "./AegisSidecar"

function DeskShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const { updatePreferences } = useDesk()
  const main = useRef<HTMLElement>(null)
  const previousPath = useRef(pathname)
  useLayoutEffect(() => {
    if (previousPath.current === pathname) return
    previousPath.current = pathname
    main.current?.scrollTo({ top: 0, left: 0, behavior: "instant" })
    main.current?.focus({ preventScroll: true })
  }, [pathname])
  useEffect(() => {
    const workspace = pathname === "/producer" ? "producer" : pathname === "/chase" ? "chase" : pathname === "/analysis" ? "analysis" : null
    if (workspace) updatePreferences({ workspace })
  }, [pathname, updatePreferences])
  return <div className="shell shell--desk">
    <StatusBar />
    <div className="shell__body">
      <Sidebar />
      <main ref={main} id="ops-main" tabIndex={-1} className="shell__content">{children}</main>
      <AegisSidecar />
    </div>
    <BottomNav />
  </div>
}

export function AppShell({ children }: { children: ReactNode }) {
  return <DeskProvider><DeskShell>{children}</DeskShell></DeskProvider>
}
