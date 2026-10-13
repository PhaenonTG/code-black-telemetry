export type ManagedBroadcast = {
  id: string; pageId: string; title: string; description: string; createdAt: string;
  status: string; observedAt: string; destination: { ciphertext: string; iv: string };
};
type Credential = { pageId: string; token: string; permissions?: string[] };
type Dependencies = {
  credential(): Promise<Credential | null>;
  broker(path: string, init?: RequestInit): Promise<Response>;
  encrypt(value: string): Promise<{ ciphertext: string; iv: string }>;
  decrypt(value: { ciphertext: string; iv: string }): Promise<string | null>;
  fetch: typeof fetch;
  enabled: boolean;
};
const INTERNAL = "/api/chase/v1/facebook/internal/broadcast";
const GRAPH = "https://graph.facebook.com/v26.0";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const terminalBroadcast = (status: string) => ["LIVE_STOPPED", "PROCESSING", "VOD", "ENDED", "SCHEDULED_CANCELED"].includes(status);
export function validManagedDestination(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 4096) return false;
  try { const url = new URL(value); return url.protocol === "rtmps:" && url.hostname === "live-api-s.facebook.com" && (!url.port || url.port === "443") && /^\/rtmp\/[A-Za-z0-9_-]{10,2048}$/.test(url.pathname) && !url.username && !url.password && !url.hash && !url.search; } catch { return false; }
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
const publicBroadcast = (value: ManagedBroadcast | null) => value ? { id: value.id, pageId: value.pageId, title: value.title, description: value.description, status: value.status, createdAt: value.createdAt, observedAt: value.observedAt, facebookProducerUrl: `https://www.facebook.com/live/producer/${value.id}` } : null;

export async function handleFacebookLifecycle(request: Request, userId: string | undefined, controlAllowed: boolean, workstation: boolean, deps: Dependencies): Promise<Response> {
  const path = new URL(request.url).pathname;
  const [stateResponse, credential] = await Promise.all([deps.broker(INTERNAL), deps.credential()]);
  if (!stateResponse.ok) return json(503, { error: "BROADCAST_SERVICE_UPDATING" });
  const state = await stateResponse.json() as { broadcast: ManagedBroadcast | null; operation?: { state: string; action: string; requestId: string } | null };
  const permission = credential?.permissions?.includes("pages_manage_posts") === true;
  const enabled = deps.enabled && permission && Boolean(credential);
  const broadcast = state.broadcast;
  if (workstation) {
    if (path === "/api/producer/v1/workstation/facebook-health" && request.method === "GET") {
      if (!credential) return json(200, { state: "not_connected", publishingPermissionVerified: false });
      try {
        const response = await deps.fetch(`${GRAPH}/${credential.pageId}/live_videos?broadcast_status=%5B%22LIVE%22%5D&fields=id`, { headers: { Authorization: `Bearer ${credential.token}` }, signal: AbortSignal.timeout(5000) });
        const result = await response.json() as { error?: { code?: number } };
        const code = result.error?.code;
        return json(200, { state: response.ok ? "healthy" : [4, 17, 32, 613].includes(code ?? 0) ? "rate_limited" : "unavailable", code, publishingPermissionVerified: permission });
      } catch { return json(200, { state: "unavailable", publishingPermissionVerified: permission }); }
    }
    if (path !== "/api/producer/v1/workstation/facebook-destination" || request.method !== "GET") return json(404, { error: "NOT_FOUND" });
    if (!enabled || !broadcast || !["UNPUBLISHED", "PUBLISH_REQUESTED", "LIVE"].includes(broadcast.status)) return json(200, { destination: null });
    const destination = await deps.decrypt(broadcast.destination);
    return validManagedDestination(destination) ? json(200, { destination, videoId: broadcast.id }) : json(503, { error: "DESTINATION_UNAVAILABLE" });
  }
  if (path === "/api/producer/v1/facebook" && request.method === "GET") return json(200, { enabled, permission, canManage: enabled && controlAllowed, broadcast: publicBroadcast(broadcast), operation: state.operation ?? null });
  const action = path.split("/").pop();
  if (request.method !== "POST" || !["prepare", "publish", "end", "refresh"].includes(action || "")) return json(405, { error: "METHOD_NOT_ALLOWED" });
  if (!controlAllowed || !userId) return json(403, { error: "PRODUCER_CONTROL_FORBIDDEN" });
  if (!enabled || !credential) return json(409, { error: !permission ? "FACEBOOK_PUBLISH_PERMISSION_REQUIRED" : "FACEBOOK_LIFECYCLE_DISABLED" });
  let body: Record<string, unknown>;
  try { const text = await request.text(); if (new TextEncoder().encode(text).length > 8192) return json(413, { error: "REQUEST_TOO_LARGE" }); body = JSON.parse(text); if (!body || Array.isArray(body) || typeof body !== "object") throw new Error(); } catch { return json(400, { error: "INVALID_BROADCAST_REQUEST" }); }
  if (action !== "refresh" && (body.confirmed !== true || typeof body.requestId !== "string" || !UUID.test(body.requestId))) return json(400, { error: "CONFIRMATION_REQUIRED" });
  if (action !== "prepare" && (!broadcast || body.videoId !== broadcast.id)) return json(409, { error: "BROADCAST_CHANGED" });
  if (broadcast && broadcast.pageId !== credential.pageId) return json(409, { error: "PAGE_CHANGED" });
  const statusResponse = await deps.broker("/api/producer/v1/status");
  const bridge = await statusResponse.json() as { bridge: string; controlLease?: { userId: string; expiresAt: number }; status?: Record<string, unknown> };
  if (["prepare", "publish"].includes(action!) && (bridge.bridge !== "ONLINE" || bridge.controlLease?.userId !== userId || bridge.controlLease.expiresAt <= Date.now())) return json(409, { error: "LIVE_CONTROL_LEASE_REQUIRED" });
  if (action === "prepare") {
    const output = bridge.status?.broadcast as { state?: string; requested?: boolean } | undefined;
    if (output?.requested || output?.state !== "OFF") return json(409, { error: "STOP_ENCODER_BEFORE_PREPARING" });
    if (typeof body.title !== "string" || !body.title.trim() || body.title.length > 254 || typeof body.description !== "string" || body.description.length > 2000) return json(400, { error: "INVALID_POST_DETAILS" });
  }
  if (action === "publish") {
    const current = bridge.status;
    const output = current?.broadcast as { state?: string; managedVideoId?: string; lastSuccessAt?: string } | undefined;
    const audio = current?.audio as { process?: string; available?: boolean; silence?: boolean; clipping?: boolean; lastAudioAt?: string } | undefined;
    const metrics = current?.metrics as { last_video_timestamp?: string } | undefined;
    const fresh = (at?: string) => Boolean(at && Number.isFinite(Date.parse(at)) && Date.now() - Date.parse(at) < 5000);
    if (body.programConfirmed !== true || output?.managedVideoId !== broadcast!.id || output.state !== "SENDING" || !fresh(output.lastSuccessAt) || current?.source_state !== "SOURCE_LIVE" || !fresh(metrics?.last_video_timestamp) || audio?.process !== "RUNNING" || !audio.available || audio.silence || audio.clipping || !fresh(audio.lastAudioAt)) return json(409, { error: "PROGRAM_NOT_READY_OR_NOT_CONFIRMED" });
  }
  const callGraph = async (node: string, method: string, params: Record<string, string>) => {
    const query = new URLSearchParams(params);
    const response = await deps.fetch(`${GRAPH}/${node}${method === "GET" ? `?${query}` : ""}`, { method, headers: { Authorization: `Bearer ${credential.token}`, "Content-Type": "application/x-www-form-urlencoded" }, ...(method === "GET" ? {} : { body: query }), signal: AbortSignal.timeout(10_000) });
    const result = await response.json() as Record<string, unknown>;
    if (!response.ok) { const error = result.error as { code?: number; error_subcode?: number } | undefined; const failure = new Error("META_REJECTED") as Error & { code?: number; subcode?: number; definite: boolean }; failure.code = error?.code; failure.subcode = error?.error_subcode; failure.definite = response.status >= 400 && response.status < 500; throw failure; }
    return result;
  };
  if (action === "refresh") {
    const reserve = await deps.broker(INTERNAL, { method: "POST", body: JSON.stringify({ operation: "refresh-reserve" }) });
    if (reserve.status !== 202) return json(200, { broadcast: publicBroadcast(broadcast), refreshDeferred: true });
    try {
      const observed = await callGraph(broadcast!.id, "GET", { fields: "id,status" });
      if (typeof observed.status !== "string") throw new Error();
      const next = { ...broadcast!, status: observed.status, observedAt: new Date().toISOString() };
      const saved = await deps.broker(INTERNAL, { method: "POST", body: JSON.stringify({ operation: "observed", broadcast: next }) });
      if (!saved.ok) return json(503, { error: "STATE_SAVE_FAILED" });
      return json(200, { broadcast: publicBroadcast(next) });
    } catch (error) { return json(502, { error: "META_STATUS_UNAVAILABLE", code: (error as { code?: number }).code }); }
  }
  const digest = JSON.stringify([action, body.videoId ?? null, body.title ?? null, body.description ?? null]);
  const reserved = await deps.broker(INTERNAL, { method: "POST", body: JSON.stringify({ operation: "reserve", requestId: body.requestId, action, userId, digest, expectedId: broadcast?.id ?? null }) });
  if (reserved.status !== 202) return reserved;
  let next: ManagedBroadcast | undefined;
  let resultState = "unknown"; let code: number | undefined; let subcode: number | undefined;
  try {
    const result = await callGraph(action === "prepare" ? `${credential.pageId}/live_videos` : broadcast!.id, "POST", action === "prepare" ? { status: "UNPUBLISHED", title: (body.title as string).trim(), description: body.description as string, stream_type: "REGULAR" } : action === "publish" ? { status: "LIVE_NOW" } : { end_live_video: "true" });
    if (action === "prepare") {
      if (typeof result.id !== "string" || !/^\d{5,30}$/.test(result.id) || !validManagedDestination(result.secure_stream_url)) throw new Error("INVALID_META_DESTINATION");
      next = { id: result.id, pageId: credential.pageId, title: (body.title as string).trim(), description: body.description as string, createdAt: new Date().toISOString(), status: "PREPARE_UNCONFIRMED", observedAt: new Date().toISOString(), destination: await deps.encrypt(result.secure_stream_url) };
      const verified = await callGraph(result.id, "GET", { fields: "id,status" });
      if (verified.status !== "UNPUBLISHED") throw new Error("UNPUBLISHED_STATE_NOT_VERIFIED");
      next.status = "UNPUBLISHED";
    } else {
      if (result.success !== true && result.id !== broadcast!.id) throw new Error("META_OUTCOME_UNKNOWN");
      // A successful mutation is acknowledged, not proof of the subsequently observed public state.
      next = { ...broadcast!, status: action === "end" ? "END_REQUESTED" : "PUBLISH_REQUESTED", observedAt: new Date().toISOString() };
    }
    resultState = "succeeded";
  } catch (error) { const failure = error as { definite?: boolean; code?: number; subcode?: number }; if (failure.definite && !next) resultState = "failed"; code = failure.code; subcode = failure.subcode; }
  const saved = await deps.broker(INTERNAL, { method: "POST", body: JSON.stringify({ operation: "result", requestId: body.requestId, state: resultState, broadcast: next, code, subcode }) });
  if (!saved.ok) return json(503, { error: "OUTCOME_SAVE_UNCONFIRMED", state: "unknown" });
  return json(resultState === "succeeded" ? 200 : 502, { state: resultState, broadcast: publicBroadcast(next ?? broadcast), code, subcode, error: resultState === "succeeded" ? undefined : resultState === "unknown" ? "META_OUTCOME_UNKNOWN_DO_NOT_RETRY" : "META_REJECTED" });
}
