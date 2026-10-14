export const OBS_SCENES = ["NICK - LIVE CAMERA + STORM OVERLAY", "NICK - STANDBY"];
export const OBS_ACTIONS = new Map([
  ["obs.scene.set", ["scene", "set"]],
  ["obs.audio.set", ["audio", "set"]],
  ["obs.overlay.visibility", ["overlay", "visibility"]],
  ["obs.recording.start", ["recording", "start"]],
  ["obs.recording.stop", ["recording", "stop"]],
]);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
export function validObsPayload(action: string, payload: unknown): boolean {
  if (!record(payload)) return false;
  const keys = Object.keys(payload);
  if (action === "obs.scene.set") return keys.length === 1 && typeof payload.sceneName === "string" && OBS_SCENES.includes(payload.sceneName);
  if (action === "obs.overlay.visibility") return keys.length === 1 && typeof payload.enabled === "boolean";
  if (action === "obs.audio.set") return keys.length > 0 && keys.every(key => ["muted", "volumeDb"].includes(key))
    && (!keys.includes("muted") || typeof payload.muted === "boolean")
    && (!keys.includes("volumeDb") || (typeof payload.volumeDb === "number" && Number.isFinite(payload.volumeDb) && payload.volumeDb >= -60 && payload.volumeDb <= 0));
  return ["obs.recording.start", "obs.recording.stop"].includes(action) && keys.length === 0;
}
export function obsActionAdvertised(action: string, status: Record<string, unknown>): boolean {
  const mapping = OBS_ACTIONS.get(action);
  if (!mapping || status.engine !== "obs" || !record(status.capabilities) || !record(status.capabilities.actions)) return false;
  const actions = status.capabilities.actions[mapping[0]];
  return Array.isArray(actions) && actions.includes(mapping[1]);
}
