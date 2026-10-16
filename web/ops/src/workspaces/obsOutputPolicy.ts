export type OutputTarget = "facebook" | "youtube"
export type ObsOutputStatus = {
  engine?: string; stateRevision?: number; observedAt?: string; source_state?: string;
  composition?: { id?: string }; program?: { state?: string; lastFrameAt?: string };
  audio?: { available?: boolean; state?: string };
  outputs?: Partial<Record<OutputTarget, { state?: string; configured?: boolean; destination?: string; requiresFacebook?: boolean }>>;
  capabilities?: { actions?: { outputs?: string[] } };
}
export function outputStartReason(status: ObsOutputStatus | undefined, target: OutputTarget, owner: boolean): string | null {
  if (!owner) return "Take control before starting an output."
  if (status?.engine !== "obs") return "OBS output controls are unavailable."
  if (!status.outputs?.[target]?.configured) return target === "youtube" ? "YouTube activation/key is pending on the OBS computer." : "Facebook destination is not qualified."
  if (target === "youtube" && status.outputs.facebook?.state !== "SENDING") return "Start Facebook first; YouTube shares its 1080p PROGRAM encoders."
  if (!status.capabilities?.actions?.outputs?.includes(`${target}.start`)) return "Native output adapter is unavailable or not qualified."
  if (status.source_state !== "SOURCE_LIVE" || status.program?.state !== "RENDERING" || status.audio?.available !== true || status.audio.state !== "SIGNAL") return "Live camera and healthy PROGRAM audio are required."
  if (!/^[a-f0-9]{24}$/.test(status.composition?.id ?? "")) return "Current PROGRAM composition is unverified."
  return null
}
