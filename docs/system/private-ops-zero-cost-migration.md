# Private Ops migration with zero new recurring cost

Status: locked working baseline and first local candidate, 2026-10-14. No production routing change has been made. Change this baseline with a documented revision, not an implicit route or cost change.

## Goal and constraints

Keep the Ops website, Producer controls, live PROGRAM preview with audio, Core data, weather/radar, Chase field functions, and account authorization functional without a new recurring subscription or a Cloudflare Workers request quota dependency. Internal-only access from enrolled operator devices is acceptable. Keep the current public Ops deployment available until the private replacement passes end-to-end checks. Preserve all current branches, uncommitted work, Worker/Durable Object state, and OTA assets.

The proposed first access path is Cloudflare One **private network routing** on its Free plan, with the Cloudflare One Client on operator devices. This is a private tunnel to a service on Core or a colocated host, not a public hostname Worker route. Cloudflare documents private-network routes as exempt from its public-video restriction. Free-plan eligibility, user count, device enrollment, media behavior, and actual traffic must be verified in the account before cutover. Tailscale is an existing technical path, but its free Personal plan is explicitly for noncommercial use, so it is not the zero-cost production assumption. A self-hosted WireGuard path remains the Cloudflare-independent fallback if Core has reachable ingress or an already-funded public relay.

This plan does not promise every third-party source is unlimited. Supabase Auth, Mapbox, and weather/map sources retain their own availability, quotas, and terms. The cost gate is **zero new recurring bill** for the migration, verified against the actual account configuration.

Known existing defect: the operator reports that the local 30B review of drafts fails every time. The current chase setup workflow calls `qwen3-coder:30b` after Aegis, allows a longer 225-second transport window, and marks the workflow `incomplete` when either review is unavailable. The existing approval gate then blocks posting a Reviewed Briefing. The private-site migration must not conceal that state or turn a failed model result into a passing review. This defect is in scope for diagnosis and repair before declaring draft workflows fully functional. No paid fallback may run automatically; any replacement reviewer must be local/free, evidence-bounded, and validated against the same safety rules. Confirm whether tropical drafts share the symptom before changing that separate workflow.

Diagnostic update, 2026-10-14: read-only inspection of saved Core advisory metadata found two older revisions with validation failures and one later revision with both reviewers ready. Current active drafts have no saved advisory result yet. The failure is therefore intermittent in the stored evidence; the operator's recurring failure still needs a current reproduction. A candidate Core change now records which allowlisted assessment field failed shape validation and retains a successful Aegis review when retrying the same packet after a 30B failure. A candidate Ops change shows safe failure categories rather than only a generic retry message. These changes remain undeployed and do not weaken the approval gate.

Access check, 2026-10-14: the signed-in Cloudflare One dashboard shows **Zero Trust Free**. The existing healthy Core tunnel has three published application routes and no private network route. No route or billing setting was changed. A private route and one enrolled device still require a pilot; the existing published routes are not the proposed video path. A synthetic, local-only `qwen3-coder:30b` assessment completed successfully in about 20 seconds with the expected top-level field types, so model installation/availability is not the persistent failure. Real draft packet validation remains the open issue.

Private hostname design check, 2026-10-14: Cloudflare's current private-hostname route uses the enrolled client's DNS/traffic path, then resolves the hostname on the `cloudflared` host. It does not provide a browser-trusted TLS certificate to the origin. Core currently has no Caddy/Certbot installation; Tailscale Serve owns `100.96.77.89:443`, while `192.168.0.187:443` is free. The pilot therefore needs a distinct hostname under a controlled public domain, a DNS-01 certificate (so the site itself stays private), a TLS listener bound only to the intended Core interface, and an origin-side hostname mapping. Verify the Cloudflare private route and Gateway access policy with one device before changing DNS or operator login redirects. Do not substitute a Cloudflare Origin CA certificate directly in the browser path; enrolled browsers must trust the certificate.

Mobile routing correction, 2026-10-14: Tailscale documents that iOS permits only one active VPN. The current Ops UI directly links to the PHAENON3 AI console at `phaenon3.tail1d0673.ts.net` and the private player at `codeblack-core.tail1d0673.ts.net/mtx`. Those links would fail on an iPhone using Cloudflare One instead of Tailscale. The iOS pilot must therefore use Cloudflare One as its active VPN and reach both functions through new private routes or a secured same-origin relay before cutover. Do not assume simultaneous WARP/Tailscale operation on the iPhone or iPad. Desktop coexistence remains a separate test. Keep the existing Tailscale path available for rollback and any current workflows until replacements pass.

The candidate server accepts optional `OPS_PRIVATE_TLS_CERT` and `OPS_PRIVATE_TLS_KEY` file paths, `OPS_PRIVATE_BIND_HOST` and `OPS_PRIVATE_HOSTNAME`. It refuses a non-loopback bind without TLS and the expected hostname, and rejects a mismatched Host header. Keep the certificate/key outside the repository with restricted file permissions. Host checking is an extra guard, not a replacement for Cloudflare Access/Gateway policy and host firewall rules. The current executable remains loopback HTTP by default.

Core currently provides Node 18.19.1. The private gateway bundle targets Node 18; the site build itself can be produced elsewhere and copied as immutable assets. The existing Producer Durable Object and OBS bridge sources live in separate gateway and workstation checkouts; the gateway checkout has active uncommitted work, so the private Producer port must use an isolated snapshot and must not overwrite that checkout.

Node 18 loopback check, 2026-10-14: copied only the private server and gateway bundle into a new `/tmp/codeblack-private-ops-pilot-20261014-r1` directory on Core. A transient listener bound to `127.0.0.1:4187` returned 200 for `/health` and the Storm Intel overlay health relay, 401 for unauthenticated `/api/core/*`, and JSON 503 for `/api/producer/v1/status`. The exact pilot Node process was stopped and the port was verified closed. No private hostname, Cloudflare route, certificate, login configuration, browser assets, or production service was changed. This proves runtime compatibility and route isolation only; authenticated Core writes, static site login, live media, and operator-device access still need their gates.

Implementation update, 2026-10-14: a local private Ops server candidate now has an optional `/api/core/*` handler. It reuses the production Core allowlist and Supabase active-profile check, forwards only to loopback Core, strips unknown query keys, signs authorized draft writes with the same Core HMAC contract, and streams Fabric NDJSON. The two public Storm Intel overlay reads, the public Mapbox token route, ARDOT HLS camera relay, and camera health route also have private candidates. Camera health redirects are now checked at every hop against the approved provider hosts before fetching media. Producer, Chase, other road relays, and public hurricane remain explicit 503 responses. The candidate has unit tests but has not been deployed or connected to a Cloudflare private route. A private build must embed the current Supabase public URL/key and set `VITE_CODEBLACK_CORE_BASE_URL=/api/core`; the server process must receive the same public auth values, `OPS_PRIVATE_CORE_BASE_URL=http://127.0.0.1:8000`, the existing Core `CODEBLACK_OPS_WRITE_SECRET` value as `OPS_PRIVATE_WRITE_SECRET`, and optionally `MAPBOX_PUBLIC_TOKEN` through protected runtime configuration. Do not print or commit those values. Run `npm run build:private-gateway` before starting the server with Core routing enabled.

30B reproduction, 2026-10-14: a read-only call with one current production draft packet returned `unsupported_absence_claim` after about 19 seconds. The claim guard correctly rejected the result; no advisory or decision was written. Adding an explicit evidence-scoped wording instruction to the snapshot produced one `ready` result on the same packet under the unchanged guards. An intermediate probe returned a PHAENON3 non-200 response, so reliability is not yet proven. The Core review change was deployed on 2026-10-15 UTC as `setup-review-diagnostics-20261014-r1`, copied from the active RRFS release with only `chase_setup_review.py` overlaid. Service and four read endpoint checks returned healthy. The Ops failure-category UI remains a candidate. Repeated real workflow checks are required before the draft-review gate can pass.

Review release update, 2026-10-15 UTC: Core now runs `setup-review-retry-20261014-r2`, which makes one bounded corrective attempt after local validation failure using a fresh request ID. Four Core read endpoints returned HTTP 200 after restart. Two active setup revisions completed with both reviewers `ready` and no approval blockers; no briefing was approved or published. One PHAENON3 non-200 response still interrupted a 30B attempt on the second setup. A later manual retry reused the ready Aegis result and completed 30B. Treat the local reviewer as improved, with a remaining transient worker rejection to monitor. The Ops failure-category UI and private-site candidate are still undeployed.

## Current dependencies found in source

The current route contract is grouped below. Each route family needs an explicit private implementation; unimplemented families must return JSON 503 rather than the React application shell.

| Browser path family | Current handler | Private candidate | Cutover status |
| --- | --- | --- | --- |
| `/api/core/*` | Ops Pages Worker, Supabase auth, Core VPC gateway | Local Core allowlist/auth/signing candidate | Unit tested; live auth, read, write and stream parity pending |
| `/api/producer/v1/*` | Chase Gateway Durable Object | None | 503; live media/commands block cutover |
| `/api/chase/v1/*` | Chase Gateway and Core broker | None | 503; Facebook and field flow block cutover |
| `/api/ardot-camera-stream`, `/api/camera-health` | Ops Pages camera relays | Reused handlers with redirect host checks | Unit tested; live camera parity pending |
| `/api/public/hurricane`, `/api/kandrive/*`, `/api/modot/*`, `/api/odot/*`, `/api/tdot/*` | Ops Pages Worker/provider relays | None | 503; map and road parity pending |
| `/overlay-core/api/storm-intel/v1/health`, `/overlay-core/api/storm-intel/v1/point`, `/overlay-core/mapbox-token` | Ops Pages public context relays | Local Core and token handlers | Unit tested; private overlay browser parity pending |
| Other `/overlay-core/*` | Ops Pages route guard | None | JSON 404 through the private handler |


| Surface | Current location | Migration requirement |
| --- | --- | --- |
| Ops static React app and login | Cloudflare Pages `web/ops`; Supabase Auth and `profiles` | Serve the exact built assets privately; keep Supabase authorization and update password reset URLs for the private origin. |
| Ops `/api/core/*` and fabric stream | Pages Advanced Mode Worker, fixed Core allowlist and Supabase token validation | Implement equivalent same-origin routes on Core, preserving allowlist, methods, limits, auth, streaming and error semantics. |
| Public hurricane, Mapbox token, road/camera, and overlay relays | Pages Worker and functions | Inventory each caller and replace with Core-side relay or direct safe provider access; preserve overlays that run without an Ops login. |
| Producer `/api/producer/v1/*` | Chase Gateway Worker plus Durable Object | Move status, capabilities, lease, commands, acknowledgments, Facebook state, JPEG, HLS manifest and segments to a persistent private service. Preserve command idempotency, lease, state revision and freshness rules. |
| OBS workstation bridge | `ObsProducerBridge/src/bridge.cjs`, fixed public gateway base | Add a configurable, authenticated private endpoint only after its server exists. Never restart the running OBS bridge during shadow tests. |
| AI console and private player links | Ops UI points directly to two `*.ts.net` origins | Give Cloudflare One mobile clients a tested route or secured same-origin relay for both before iOS cutover. |
| Chase `/api/chase/*` | Chase Gateway Worker; Core VPC binding | Inventory field phone, public-location, Facebook, comments and OTA callers individually. Do not move or remove public ingress until the field devices have a tested private route. |
| Facebook OAuth/replies | Chase Gateway Worker and Core broker | Keep a valid redirect URL, callback/session security and connected account state. Confirm the private origin works with the provider's registered redirect before switching. |
| Chase OTA release assets | Gateway Worker assets | Preserve version 22 and archive; migrate only after download and hash checks from field devices. |
| Draft advisory review | Core review job, PHAENON3 local `qwen3:8b` and `qwen3-coder:30b` | Diagnose persistent 30B failure and make the local reviewer reliable or explicitly replace it with a validated free local model. Preserve failure visibility, evidence validation, revision binding and human approval. |

Observed load source: the OBS bridge runs a two-second cycle with three gateway calls (status, capabilities, commands). At full cadence this alone could create 129,600 Worker requests/day; JPEG and HLS uploads add more. Moving only browser polling cannot remove that load.

Read-only host check on 2026-10-14: Core is online in the existing tailnet with 127 GB free disk and roughly 3 GB available RAM. `cloudflared` and `tailscaled` are active. Tailscale Serve already owns the Core tailnet HTTPS origin and several paths; a candidate must use a separate hostname/port and must not replace this mapping. The workstation tailnet also shows Core, an iPhone and an iPad online. These observations confirm a reachable pilot environment, but do not establish the Cloudflare One account's plan or any device's Cloudflare One enrollment.

## Target architecture

1. Build `web/ops` as today, then serve its static output on Core behind a private HTTPS origin. Serve API routes from the same origin to avoid browser private-network and CORS problems. Keep its Supabase login and profile check.
2. Put a dedicated private Producer service near Core. OBS workstation and operator browser both reach this service over the private network. Store commands and state durably on Core; use a persistent push connection for live status where it improves responsiveness. Keep HLS/preview media on the private route.
3. Route operator devices through Cloudflare One Client and a **private network** Cloudflare Tunnel. Restrict enrollment and per-route access. Validate iPhone, iPad and desktop connectivity, including coexistence with the currently active Tailscale client.
4. Keep public brand content separate. Keep necessary public Chase/Facebook/OTA endpoints on the current path until equivalent access is validated. Do not treat moving the operator site as authorization to break field ingestion or Facebook callback.
5. After traffic is measured, retire only the Worker routes that have complete replacement and no remaining callers. If a Cloudflare-free path becomes necessary, replace the private tunnel with self-hosted WireGuard without changing the same-origin application contracts.

## Work sequence and release gates

### 0. Baseline and account check

- Capture current production versions, route list, Workers request volume by route, Core service health, OBS bridge state, free-plan/user counts, DNS, and rollback artifacts without printing secrets.
- Record all active worktrees and staged changes. Work only in isolated checkouts; never reset, clean, or overwrite another agent's work.
- Verify Cloudflare One Free account eligibility and the private route's behavior. If there is a cost, usage, or device compatibility blocker, use the WireGuard feasibility track before committing to an access method.
- Capture one failed draft-review attempt's model-specific reason, elapsed time and validation result without copying private draft prose or credentials into logs. Separate model availability, timeout/resource exhaustion, response shape, and guard rejection. Check both the chase setup and tropical draft workflows rather than assuming one root cause.

Gate: exact current versions, a genuine $0 access path, and a reproducible 30B failure classification are documented.

### 1. Private site skeleton

- Deploy a candidate static Ops build and a health endpoint on Core at a private hostname, behind an authenticated private network route.
- Issue and renew a browser-trusted certificate through DNS-01 for that controlled hostname; keep public A/AAAA records and published application routes absent. Terminate HTTPS on Core and restrict the listener to the pilot interface and enrolled route.
- Preserve the current `ops.codeblackwx.com` deployment. Configure the private origin in Supabase allowed redirects and validate login, logout, password reset, profile authorization and session refresh.
- Test desktop, iPhone and iPad, including reconnect after changing networks. On iOS use Cloudflare One as the sole active VPN and verify replacement access to the AI console and private player; test desktop coexistence with Tailscale separately.

Gate: private site loads on all operator devices and only authorized users can use it; current site still works.

### 2. Core and provider route parity

- Move `/api/core/*` with the same allowlist, Supabase token verification, body limits, timeout behavior and fabric stream semantics.
- Replace Pages-only public hurricane, Mapbox-token, road/camera and overlay relays where used. Audit provider terms and caching before choosing direct calls versus Core proxy.
- Automate route-contract checks so an API path returns its expected content type and status, never the SPA HTML fallback.

Gate: map/radar, weather, alerts, soundings, Aegis, status, cameras, road layers and overlays match production from the private origin.

### 2a. Restore free draft review

- Reproduce a bounded private draft review against the local model path and record only diagnostic metadata. Inspect PHAENON3 model availability, queueing, memory/offload pressure, 225-second deadline, output schema, and post-response claim guards.
- Correct the actual failure in the Core-to-PHAENON3 call or response handling. If `qwen3-coder:30b` cannot complete reliably on the available hardware, qualify a smaller **local** second reviewer and update the model identity and tests explicitly. Keep Aegis and the second review independent.
- Show the specific safe failure category in Ops and retain retry controls. Do not convert `unavailable` to `ready`, remove the second-review requirement, or auto-spend on a paid model.

Gate: repeated reviews of current bounded drafts complete or fail with an accurate actionable reason; a failed review still blocks posting, and a successful review passes the existing evidence and revision checks. Verify the tropical draft path separately if affected.

### 3. Producer service and workstation shadowing

- Port Durable Object data rules to a durable private store: latest status/capabilities; frame and HLS freshness; bounded command journal; lease owner/expiry; command idempotency; acknowledgments; revision checks; Facebook safety interlocks.
- Build a private client endpoint for the OBS bridge and an operator endpoint for the browser. Keep credentials server-side. Add a read-only shadow feed first; it must not consume or execute commands.
- Test live preview and PROGRAM HLS with audio, disconnect/reconnect, stale frame rejection, command ordering and explicit emergency stop. Keep Facebook output off during qualification.
- Switch a single running bridge only in a planned window with its command journal backed up and a known rollback target. Never run two active command consumers at once.

Gate: sustained live preview/audio and actual authenticated command acknowledgments; safe rollback tested; Worker request rate falls below the free quota with margin.

### 4. Chase, Facebook and OTA

- Identify every field device and external callback using `/api/chase/*`. Decide per caller whether to enroll its device on the private route or retain a small public ingress.
- Preserve Facebook OAuth redirects and broker state. Validate connect, status, comments and replies without publishing a stream.
- Preserve OTA version 22 and release archive; verify identical bytes/hash on the selected access path before migrating download routes.

Gate: field GPS, configuration, Facebook state and release downloads work from real devices; no active caller depends on a route being removed.

### 5. Cutover and observation

- Roll out privately to one device, then the operator set. Keep old Ops and gateway deployments intact during observation.
- Monitor request counts, bandwidth, service errors, producer media freshness, command acknowledgments, auth failures and device reconnection.
- Restore the fast Producer experience only after the private path demonstrates stable delivery. Retire old routes only after the dependency inventory and rollback window are complete.

Gate: full production workflow, including draft review, passes on the private site and no new recurring charge appears.

## Rollback

The current Pages site, Chase Gateway Worker, Durable Object and OBS bridge configuration remain available until cutover is proven. A failed private pilot routes operators back to the unchanged public site. A failed bridge switch stops the private bridge, restores the original gateway endpoint and journal, then verifies status and command acknowledgments before resuming controls. Do not roll back by overwriting the Durable Object, deleting release assets or starting duplicate workstation consumers.

## Immediate next engineering slice

1. Confirm the Cloudflare One account's Free eligibility and device enrollment; select a non-production hostname and one pilot device.
2. Build and run `web/ops/scripts/serve-private.mjs` in an isolated Core release directory, with no DNS or production process change. It binds only to loopback, serves a supplied `dist` directory, exposes `/health`, and returns JSON 503 for unmigrated `/api/*` and `/overlay-core/*` instead of the SPA. A local test already verifies static assets, SPA routes, route rejection and health. For a manual pilot: set `OPS_PRIVATE_PORT` to a free unprivileged port and `OPS_PRIVATE_DIST` to the exact candidate build directory, then run `node web/ops/scripts/serve-private.mjs` from the checkout. Do not point the production domain at it while APIs are unmigrated.
3. Classify the recurring local 30B draft-review failure from one real attempt's bounded diagnostics, then repair or qualify a free local replacement in a separate isolated Core checkout. Preserve the current approval gate throughout.
4. Write and run the route-contract matrix against both current production and the candidate, then migrate the least stateful Core relays before Producer.

No production cutover occurs until the relevant gate passes.

## Access references

- Cloudflare private hostname routing and DNS resolution: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/private-net/cloudflared/connect-private-hostname/
- Cloudflare private IP/hostname Access application policy: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/non-http/self-hosted-private-app/
- Let's Encrypt DNS-01 validation without an exposed web server: https://letsencrypt.org/docs/challenge-types/
- Tailscale's mobile one-VPN limit: https://tailscale.com/docs/reference/faq/other-vpns
