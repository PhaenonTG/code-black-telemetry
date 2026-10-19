/** Give the browser a paint opportunity before admitting optional startup work. */
export function afterPaintIdle(run: () => void): () => void {
  let stopped = false
  let cancelIdle = () => {}
  const admit = () => {
    if (stopped) return
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(() => { if (!stopped) run() }, { timeout: 1000 })
      cancelIdle = () => cancelIdleCallback(id)
    } else {
      const id = setTimeout(() => { if (!stopped) run() }, 32)
      cancelIdle = () => clearTimeout(id)
    }
  }
  const hasFrame = typeof requestAnimationFrame === "function"
  const frame = hasFrame ? requestAnimationFrame(admit) : setTimeout(admit, 16)
  return () => {
    stopped = true
    if (hasFrame) cancelAnimationFrame(frame as number)
    else clearTimeout(frame)
    cancelIdle()
  }
}
