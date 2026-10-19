// Owns one polling lane. Superseding reads and cleanup invalidate late results,
// even when an auth provider, fetch mock, or body reader ignores cancellation.
export const PRODUCER_REQUEST_TIMEOUT_MS = 10_000

export function createProducerPoll() {
  let controller: AbortController | undefined
  let active = true
  const cancel = () => { controller?.abort(); controller = undefined }
  return {
    isPending() { return controller !== undefined },
    activate() { active = true },
    cancel,
    dispose() { active = false; cancel() },
    async run<T>(work: (signal: AbortSignal) => Promise<T>, success: (value: T) => void, failure: (reason: unknown) => void, timeoutMs = PRODUCER_REQUEST_TIMEOUT_MS): Promise<void> {
      if (!active) return
      cancel()
      const request = new AbortController()
      controller = request
      const aborted = new Promise<never>((_resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true })
      })
      const timer = setTimeout(() => request.abort(new DOMException(`Producer request timed out after ${timeoutMs / 1000} s; last received data may be stale.`, "TimeoutError")), timeoutMs)
      try {
        const value = await Promise.race([aborted, work(request.signal)])
        if (active && controller === request && !request.signal.aborted) success(value)
      } catch (reason) {
        if (active && controller === request) failure(reason)
      } finally {
        clearTimeout(timer)
        if (controller === request) controller = undefined
      }
    },
  }
}

// Completion-driven scheduling: an interval tick can never overlap a command read.
// The lane also rejects late responses after replacement, timeout or disposal.
export function pollProducerCommand<T>(read: (signal: AbortSignal) => Promise<T>, terminal: (value: T) => boolean, receive: (value: T) => void, failure: (reason: unknown) => boolean, delay = 1500) {
  const poll = createProducerPoll()
  let stopped = false
  let timer: ReturnType<typeof setTimeout>
  const tick = async () => {
    if (stopped) return
    await poll.run(read, value => { stopped = terminal(value); receive(value) }, reason => { stopped = failure(reason) })
    if (!stopped) timer = setTimeout(() => void tick(), delay)
  }
  timer = setTimeout(() => void tick(), delay)
  return () => { stopped = true; clearTimeout(timer); poll.dispose() }
}
