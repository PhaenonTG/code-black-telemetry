// Shared by Producer panels so a Cloudflare limit pauses all background reads.
let retryAt = 0
let failures = 0

export function producerReadAllowed(): boolean { return Date.now() >= retryAt }

export function noteProducerResponse(response: Response): void {
  if (response.status !== 429) {
    if (response.ok && Date.now() >= retryAt) failures = 0
    return
  }
  failures = Math.min(failures + 1, 4)
  const header = response.headers.get("Retry-After")
  const seconds = header ? Number(header) : NaN
  const date = header ? Date.parse(header) : NaN
  const advised = Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(date) ? date - Date.now() : 0
  retryAt = Math.max(retryAt, Date.now() + Math.max(advised, Math.min(30_000 * 2 ** (failures - 1), 120_000)))
}

export function producerRetryMessage(): string {
  return `Producer requests are rate limited. Background checks paused until ${new Date(retryAt).toLocaleTimeString()}.`
}
