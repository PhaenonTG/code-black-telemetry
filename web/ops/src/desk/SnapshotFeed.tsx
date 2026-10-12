import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { refreshedSnapshot, snapshotUsesProviderCache } from "./cameraMedia"
type Frame = { url: string; key: string }

// Keep the last decoded frame on screen while the next request is in flight.
// A failed refresh is not a new observation and must not erase the last frame.
export function SnapshotFeed({ url, tick, name, stale = false, fallback = false, retry }: {
  url: string | null; tick: number; name: string; stale?: boolean; fallback?: boolean; retry: () => void
}) {
  const [frame, setFrame] = useState<Frame | null>(null)
  const [settled, setSettled] = useState<{ key: string; phase: "ready" | "failed" } | null>(null)
  const source = refreshedSnapshot(url, tick)
  const requestKey = `${tick}:${source ?? ""}`
  const currentRequest = useRef(requestKey)
  useLayoutEffect(() => { currentRequest.current = requestKey }, [requestKey])
  const phase = !source ? "failed" : settled?.key === requestKey ? settled.phase : "loading"
  useEffect(() => {
    if (!source || requestKey === frame?.key) return
    const timeout = window.setTimeout(() => setSettled({ key: requestKey, phase: "failed" }), 15_000)
    return () => window.clearTimeout(timeout)
  }, [source, requestKey, frame?.key])
  const loaded = async (candidate: Frame, image: HTMLImageElement) => {
    try { await image.decode() } catch { /* Some camera image formats do not expose decode. */ }
    if (currentRequest.current !== candidate.key || !image.isConnected) return
    if (!image.naturalWidth) { setSettled({ key: candidate.key, phase: "failed" }); return }
    setFrame(candidate); setSettled({ key: candidate.key, phase: "ready" })
  }
  // Promote the same keyed <img>, not a second request for its URL. Many DOT
  // cameras use Cache-Control: no-store; preloading then replacing an img fetches twice.
  // A signed URL cannot be cache-busted. Recheck it without modifying its signature;
  // browsers may reuse its decoded image, so do not claim a newly received observation.
  const frames = [frame, source && requestKey !== frame?.key ? { url: source, key: requestKey } : null].filter((candidate): candidate is Frame => !!candidate)
  const label = phase === "failed" ? frame ? "Last snapshot · Refresh failed" : "Image unavailable" : frame ? fallback ? "Fallback snapshot" : snapshotUsesProviderCache(url) ? "Snapshot · Provider-controlled refresh" : "Snapshot" : "Loading snapshot"
  return <>
    {frames.map((candidate) => <img key={candidate.key} src={candidate.url} className={candidate.key === frame?.key ? undefined : "desk-snapshot-pending"} alt={candidate.key === frame?.key ? name : ""} aria-hidden={candidate.key !== frame?.key || undefined} referrerPolicy="no-referrer" onLoad={(event) => { void loaded(candidate, event.currentTarget) }} onError={() => { if (currentRequest.current === candidate.key) setSettled({ key: candidate.key, phase: "failed" }) }} />)}
    {!frame && phase === "failed" && <div className="desk-camera-feed__empty"><strong>Image unavailable</strong><button onClick={retry}>Retry camera</button></div>}
    <span className="desk-camera-feed__badge" role="status">{label}{stale ? " · Stale source" : ""}</span>
    {frame && phase === "failed" && <button className="desk-camera-feed__retry" onClick={retry}>Retry refresh</button>}
  </>
}
