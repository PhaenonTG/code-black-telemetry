import { useEffect, useState } from "react"

// Compact top strip for desktop/tablet -- not a duplicate of the Operations page, just the
// handful of things worth glancing at without navigating away from whatever workspace is open.
export function StatusBar({ locationLabel }: { locationLabel: string }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return (
    <div className="statusbar">
      <div className="statusbar__item statusbar__item--core">
        <i className="statusbar__dot statusbar__dot--offline" />
        CORE OFFLINE
      </div>
      <div className="statusbar__item">{locationLabel}</div>
      <div className="statusbar__spacer" />
      <div className="statusbar__item statusbar__clock">
        {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </div>
    </div>
  )
}
