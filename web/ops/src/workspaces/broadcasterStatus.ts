export type VideoFormat = { width?: number; height?: number; fps?: number | null; codec?: string; bitrateKbps?: number; basis?: string }
export type OverlaySettings = { bug: { enabled: boolean; text: string }; live: { enabled: boolean }; sourceName: { enabled: boolean }; lowerThird: { enabled: boolean; text: string }; callsign: string; vehicle: string }
export type NativeStatus = {
  stateRevision: number; source_state?: string; transport_state?: string
  broadcast?: { state?: string; managedVideoId?: string | null }
  audio?: { available?: boolean; silence?: boolean; clipping?: boolean; rmsDb?: number | null; leftPeakDb?: number | null; rightPeakDb?: number | null }
  formats?: { source?: VideoFormat | null; program?: VideoFormat; monitor?: VideoFormat }
  overlays?: OverlaySettings; composition?: { id?: string; source?: string; policy?: string }
  previews?: { program?: { state?: string; compositionId?: string } }
  monitor?: { state?: string; lastSuccessAt?: string | null; compositionId?: string | null }
  cameraArchive?: { state?: string }; recording?: { requested?: boolean }
  metrics?: { video_age_ms?: number | null; video_fps?: string | number | null; output_bitrate?: string | null; reconnect_count?: number }
  capabilities?: { actions?: { composition?: string[]; camera360?: string[] } }
}
export function formatResolution(value?: VideoFormat | null): string {
  if (!value || !Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height) || value.width! <= 0 || value.height! <= 0) return "Not reported"
  return `${value.width} × ${value.height}${typeof value.fps === "number" && Number.isFinite(value.fps) && value.fps > 0 ? ` · ${value.fps} fps` : ""}`
}
export function compositionAligned(status?: NativeStatus): boolean {
  const id = status?.composition?.id
  return status?.source_state === "SOURCE_LIVE" && Boolean(id) && status.previews?.program?.compositionId === id && status.monitor?.state === "CURRENT" && status.monitor.compositionId === id
}
