export class RequestMemo {
  private readonly reads = new Map<string, { expiresAt: number; promise: Promise<unknown> }>()

  constructor(private readonly maxEntries = 30) {}

  get<T>(key: string, ttlMs: number, load: () => Promise<T>, now = Date.now()): Promise<T> {
    let entry = this.reads.get(key)
    if (!entry || entry.expiresAt <= now) {
      const promise = load()
      entry = { expiresAt: now + ttlMs, promise }
      this.reads.set(key, entry)
      void promise.catch(() => { if (this.reads.get(key)?.promise === promise) this.reads.delete(key) })
      while (this.reads.size > this.maxEntries) {
        const oldest = this.reads.keys().next().value as string | undefined
        if (!oldest) break
        this.reads.delete(oldest)
      }
    }
    return entry.promise as Promise<T>
  }
}
