import { useEffect, useState } from "react"

export type ViewportClass = "phone" | "tablet" | "desktop"

// Breakpoints match what the responsive QA pass actually tests against: phone up to 767px,
// tablet 768-1199px (covers both 768x1024 and 1024x768 orientations), desktop 1200px+.
function classify(width: number): ViewportClass {
  if (width < 768) return "phone"
  if (width < 1200) return "tablet"
  return "desktop"
}

export function useViewport(): ViewportClass {
  const [cls, setCls] = useState<ViewportClass>(() =>
    typeof window === "undefined" ? "desktop" : classify(window.innerWidth),
  )
  useEffect(() => {
    const onResize = () => setCls(classify(window.innerWidth))
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  return cls
}
