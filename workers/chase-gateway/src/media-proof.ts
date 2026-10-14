export type MediaStatus = {
  engine?: string; observedAt?: string; source_state?: string;
  composition?: { id?: string };
  program?: { state?: string; compositionId?: string; generation?: string; lastFrameAt?: string };
  previews?: { program?: { state?: string } };
  metrics?: { last_video_timestamp?: string };
};
export const COMPOSITION_ID = /^[a-f0-9]{24}$/;
export const MEDIA_GENERATION = /^[a-f0-9]{32}$/;
export function mediaFresh(at: string | undefined, max: number): boolean {
  const age = at ? Date.now() - Date.parse(at) : NaN;
  return Number.isFinite(age) && age >= -2000 && age <= max;
}
export function compositionMatches(body: MediaStatus, mediaId?: string): boolean {
  const id = body.composition?.id;
  if (id === undefined) return body.engine !== "obs";
  return typeof id === "string" && COMPOSITION_ID.test(id) && mediaId === id;
}
export function programEligible(status: { receivedAt: string; body: MediaStatus } | undefined, legacyHls = false): boolean {
  if (!status || !mediaFresh(status.receivedAt, 10000)) return false;
  const body = status.body;
  if (body.engine !== "obs") return body.source_state === "SOURCE_LIVE" && (!legacyHls || (body.previews?.program?.state === "ACTIVE" && mediaFresh(body.metrics?.last_video_timestamp, 5000)));
  const id = body.composition?.id, program = body.program;
  return typeof id === "string" && COMPOSITION_ID.test(id) && body.previews?.program?.state === "ACTIVE"
    && mediaFresh(body.observedAt, 5000) && program?.state === "RENDERING" && program.compositionId === id
    && typeof program.generation === "string" && MEDIA_GENERATION.test(program.generation) && mediaFresh(program.lastFrameAt, 5000);
}
