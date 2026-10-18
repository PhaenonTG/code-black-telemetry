import { useEffect, useState } from "react"
import { getAppTheme, loadAppTheme, subscribeAppTheme } from "../../../../src/services/settings"

export function useShellTheme() {
  const [theme, setTheme] = useState(getAppTheme)
  const [systemLight, setSystemLight] = useState(() => window.matchMedia("(prefers-color-scheme: light)").matches)

  useEffect(() => {
    const unsubscribe = subscribeAppTheme(setTheme)
    void loadAppTheme().catch(() => undefined)
    return unsubscribe
  }, [])

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)")
    const update = () => setSystemLight(media.matches)
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  return theme === "system" ? systemLight ? "light" : "dark" : theme
}
