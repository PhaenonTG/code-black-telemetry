import { afterPaintIdle } from "../pages/afterPaintIdle"

/** Mount once near the viewport; never tear down a map when it scrolls away. */
export function deferPanel(host: Element, reveal: () => void): () => void {
  let stopped = false, admitted = false
  let cancelIdle = () => {}
  let observer: IntersectionObserver | undefined
  const admit = () => {
    if (stopped || admitted) return
    admitted = true
    observer?.disconnect()
    cancelIdle = afterPaintIdle(() => { if (!stopped) reveal() })
  }
  if (typeof IntersectionObserver === "function") {
    observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) admit()
    }, { rootMargin: "160px" })
    observer.observe(host)
  } else admit()
  return () => { stopped = true; observer?.disconnect(); cancelIdle() }
}
