/** Bound the full read, even if a transport ignores cancellation. */
export async function requestDeadline<T>(read: (signal: AbortSignal) => Promise<T>, timeoutMs: number, outerSignal?: AbortSignal): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  let rejectAbort: () => void = () => {}
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(new DOMException("Timed out", "AbortError"))
    controller.signal.addEventListener("abort", rejectAbort, { once: true })
  })
  const timer = setTimeout(abort, timeoutMs)
  outerSignal?.addEventListener("abort", abort, { once: true })
  if (outerSignal?.aborted) abort()
  try {
    return await Promise.race([cancelled, controller.signal.aborted ? cancelled : read(controller.signal)])
  }
  finally {
    clearTimeout(timer)
    outerSignal?.removeEventListener("abort", abort)
    controller.signal.removeEventListener("abort", rejectAbort)
  }
}
