export const OBS_SCENES = ["NICK - LIVE CAMERA + STORM OVERLAY", "NICK - STANDBY"] as const
export type ObsStatus = {
  engine?: string
  stateRevision: number
  source_state?: string
  stateReason?: string
  formats?: { program?: { width?: number; height?: number; fps?: number } }
  obs?: { scenes?: string[]; currentScene?: string; fieldlineVisible?: boolean }
  audio?: { available?: boolean; inputMuted?: boolean; inputVolumeDb?: number }
  recording?: { writeToDisk?: boolean; kind?: string }
  broadcast?: { state?: string }
  capabilities?: { actions?: Record<string, string[]> }
}
const COMMANDS: Record<string, readonly [string, string]> = {
  "obs.scene.set": ["scene", "set"], "obs.audio.set": ["audio", "set"],
  "obs.overlay.visibility": ["overlay", "visibility"], "obs.recording.start": ["recording", "start"], "obs.recording.stop": ["recording", "stop"],
  "preview.start": ["preview", "start"], "preview.stop": ["preview", "stop"], "facebook.output.stop": ["facebook", "output.stop"],
}
export function supportsObsAction(status: ObsStatus | undefined, action: string): boolean {
  const mapping = COMMANDS[action]
  return Boolean(status?.engine === "obs" && mapping && status.capabilities?.actions?.[mapping[0]]?.includes(mapping[1]))
}
export function obsResolution(status: ObsStatus | undefined): string {
  const format = status?.formats?.program
  if (!Number.isSafeInteger(format?.width) || !Number.isSafeInteger(format?.height) || format!.width! <= 0 || format!.height! <= 0) return "Not reported"
  const fps = typeof format?.fps === "number" && Number.isFinite(format.fps) && format.fps > 0 ? ` · ${Number(format.fps.toFixed(2))} fps` : ""
  return `${format!.width} × ${format!.height}${fps}`
}
