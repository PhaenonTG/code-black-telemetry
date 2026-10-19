export function CachedAssessmentNotice({ receivedAt, refreshing }: { receivedAt: number; refreshing: boolean }) {
  return <p className="hurricane-watch__cached" role="status">
    Cached assessment · received <time dateTime={new Date(receivedAt).toISOString()}>{new Date(receivedAt).toLocaleString()}</time>
    {refreshing ? " · Refreshing the latest assessment…" : " · Awaiting a successful refresh; verify current NHC/NWS guidance."}
  </p>
}
