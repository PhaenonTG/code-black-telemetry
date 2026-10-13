# OPS producer integration handoff

Status: outbound bridge deployed and online. Authenticated OPS controls are deployed for Glenn, Spencer, Nick and Silas. Commands require a 30-second exclusive lease except emergency stops, expire after 15 seconds, and report actual workstation acknowledgments. Facebook output start requires explicit confirmation plus fresh video and healthy audio. Public Meta publishing/ending and 360 control remain unqualified.

Managed Meta lifecycle implementation is staged behind `FACEBOOK_LIFECYCLE_ENABLED` and the Page's `pages_manage_posts` grant. Routes: GET `/api/producer/v1/facebook`; POST `/facebook/prepare`, `/facebook/publish`, `/facebook/end`, `/facebook/refresh`. Each mutation carries a UUID `requestId`, explicit `confirmed: true`, and the current `videoId` except prepare. Prepare also takes title/description. Publish requires `programConfirmed: true` after human verification. The same single unresolved-operation lock prevents duplicate Meta side effects. Stop-encoder controls remain separate from ending a public Page broadcast.

GET `/api/producer/v1/workstation/facebook-destination` is workstation-token-only and must never be called from a browser or logged. The returned secure destination is used in memory by the native encoder. A managed broadcast's ID is passed with `facebook.output.start` as `payload.videoId` (Meta IDs are numeric strings, not command UUIDs). The gateway and workstation reject mismatches.

## Available now

- Native producer UI: `http://127.0.0.1:18766/` on the broadcast workstation only.
- Chase/OPS-authenticated comments: `GET https://ops.codeblackwx.com/api/chase/v1/comments?after=<unix-seconds>`.
- Facebook Page presence is included as `page: { label, live }` in the comments response.
- Chase build 20 (`0.1.6`) is live at `/api/chase/v1/update`.
- Field mode runs PROGRAM preview and Facebook output without automatically filling the workstation disk. The optional CLEAN camera archive remains local-only.
- Cloud bridge routes are live at `/api/producer/v1/status`, `/capabilities`, `/preview/program.jpg`, and `/commands`. All require an OPS Supabase bearer; workstation ingestion uses a separate encrypted credential.

## Required OPS layout

The producer section should have three independently failing panels:

1. PROGRAM video: current frame/video, source freshness, output state, and an explicit offline/stale plate.
2. Facebook comments: chronological viewer, connection state, and reviewed/confirmed replies restricted to approved producers as Nick's Page.
3. Controls: source/camera, preview, composition, Facebook lifecycle, recording, and lower thirds. Stop must remain available during reconnects.

Never present a cached image as live. A frame is current only when `source_state === "SOURCE_LIVE"`, the preview process is `ACTIVE`, and its server timestamp is within five seconds.

## Browser-facing API contract

All routes must sit behind the existing OPS Supabase session/profile authorization. The OPS frontend should call only same-origin `/api/...` paths.

### Status

`GET /api/producer/v1/status`

Return the native `/status` payload plus a gateway-generated `observedAt` timestamp. Strip filesystem names, process identifiers, stream endpoints, credentials, and diagnostic command lines.

### Comments

For the first slice, the OPS backend may proxy the deployed Chase comment contract:

`GET /api/chase/v1/comments?after=<cursor>` with the signed-in OPS access token.

The response contains `state`, `cursor`, `pollAfterMs`, `comments[]`, and `page.live`. Do not expose the Facebook Page access token or raw Graph errors.

### PROGRAM preview

`GET /api/producer/v1/preview/program.jpg`

Return `404` or a generated offline plate unless the source is currently live. Required headers: `Cache-Control: no-store`, `X-Producer-Frame-At`, and `X-Content-Type-Options: nosniff`.

Low-rate JPEG (one frame every 1–2 seconds) is the safe first integration. HLS can follow after the authenticated relay is load-tested; do not expose the workstation's loopback HLS paths publicly.

### Commands

`POST /api/producer/v1/commands`

```json
{
  "commandId": "uuid",
  "action": "preview.start | preview.stop | facebook.output.start | facebook.output.stop | facebook.publish | facebook.end | lowerThird.set | lowerThird.hide",
  "payload": { "text": "optional, max 120 characters" }
}
```

Return `202` with `commandId` and `state: "queued"`. Commands must be idempotent for at least ten minutes. The workstation must pull commands over an outbound authenticated channel, validate the exact allowlist again, execute only against loopback, and report the result. Never make port 18766 public.

Require a second confirmation in the UI for `facebook.publish`; keep `facebook.output.stop` and `facebook.end` one click. Log operator ID, command ID, action, accepted time, execution time, and result, but never payloads containing credentials.

## Full producer control surface

OPS should become the authoritative producer console, but it must render controls from reported capabilities instead of assuming every workstation or camera supports them.

`GET /api/producer/v1/capabilities` should return a versioned action list such as:

```json
{
  "schemaVersion": "1.0.0",
  "actions": {
    "source": ["connect", "disconnect"],
    "preview": ["start", "stop"],
    "composition": ["lowerThird.set", "lowerThird.hide"],
    "facebook": ["output.start", "output.stop"],
    "archive": ["camera.start", "camera.stop"],
    "camera360": []
  }
}
```

The eventual Insta360 controller can add capabilities without changing the OPS page contract:

- camera connect/disconnect and health;
- start/stop camera transport;
- projection mode and lens/view preset;
- pan, tilt, zoom, recenter, and saved viewpoints;
- stabilization, exposure, white balance, and bitrate when the installed SDK exposes them;
- camera-side recording and storage status.

Unsupported camera functions must be absent or disabled with a reason. Never guess that the SDK accepted a command; show `queued`, `executing`, `succeeded`, `failed`, or `timed_out` from the workstation acknowledgement.

### Facebook lifecycle is two separate controls

`facebook.output.start` starts sending PROGRAM video to Facebook. It does not itself prove that the Page is publicly live.

`facebook.publish` is the public Go Live action. Enable it only after all of these are true:

- source is fresh and PROGRAM preview is current;
- audio is available and not clipping or silent;
- Facebook is receiving frames;
- the selected destination is exactly Nick's professional Page;
- the operator has reviewed the public title/privacy/audience state;
- the operator completes an explicit confirmation dialog.

Until a server-side Meta publishing integration and its Page permissions are qualified, OPS should show `Open Facebook Live Producer` instead of pretending it can publish. Do not automate the Facebook web UI from the workstation.

`facebook.end` ends the Page broadcast when server-side support exists. `facebook.output.stop` always stops the local encoder. OPS should normally perform both for End Stream, and clearly warn if one succeeds while the other fails.

### Ownership and safety interlocks

- One authenticated producer holds a renewable 30-second control lease; everyone else is view-only.
- Emergency stop does not require the lease, but it does require an authenticated producer role and is fully audited.
- Every command carries the last observed state revision; reject stale commands with `409 STATE_CHANGED`.
- Reject Go Live when the source is stale/lost, Facebook is not receiving frames, OBS is running, another output owner exists, or the destination identity differs.
- Never place stream keys, Page tokens, SRT credentials, or workstation addresses in browser responses.
- Keep local physical controls operational if OPS or the cloud bridge fails.

## Integration sequence

1. OPS agent: build the producer route and panels against fixtures matching this document. Use comments now; keep status/preview/controls in an honest `BRIDGE OFFLINE` state.
2. Broadcaster side: add the outbound authenticated status/frame/command bridge and its replay/idempotency protections.
3. Join the two sides and test source-live, source-stale, source-lost, comment auth failure, Facebook reconnect, duplicate commands, and an OPS session expiring mid-show.
4. Only after the above passes, enable the control panel in production. Video and comments may ship read-only before remote controls.

## Four-hour show gate

Remote OPS integration is not a prerequisite for today's Facebook stream. Today's hard gate is: Nick source live, audio moving, PROGRAM preview current, Facebook Live Producer receiving video on the correct Page, Chase build 20 authenticated and showing `Connected`, then a private/unlisted rehearsal followed by operator approval to go public.
