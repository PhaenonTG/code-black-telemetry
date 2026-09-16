# Code Black OwnTracks -> Fabric HTTP Ingest (V1)

## Why an adapter, not a second tracking system

OwnTracks (iOS, HTTP mode) is a permanent emergency/fallback location publisher for Spencer's
iPhone, publishing into `cbwx-unit-striker` (Spencer Tucker / STRIKER). Fabric's own unit
registry (`code_black_core_api.fabric.FabricRegistry`) remains the single authoritative source
of unit/device identity and current state -- this adapter never stores location itself, never
duplicates Fabric state, and never invents a second unit/device registry. It exists solely to
translate OwnTracks' own JSON shape into Fabric's existing `FabricIngestMessage` contract and
call the existing, already-authoritative `POST /api/fabric/v1/ingest` (loopback-only on Core).

Treat OwnTracks as **one possible location source for STRIKER**, not STRIKER's definition.
Fabric does not currently implement multi-source precedence/arbitration (no mechanism to
prefer a newer, higher-quality onboard GPS source over a stale OwnTracks point, or vice versa)
-- this is a real, disclosed follow-up requirement, not solved in this pass. If STRIKER's real
onboard `cbwx-striker-nav`/`cbwx-striker-ops-ipad` hardware publishes at the same time as
OwnTracks, both currently write the same Fabric device slot (`cbwx-striker-ops-ipad`,
last-write-wins by `observed_at`).

## Endpoint

`POST https://codeblack-core.tail1d0673.ts.net/owntracks/v1/location`

Private only -- reachable exclusively over Tailscale, via a Tailscale Serve path mapping added
alongside (not replacing) the existing `/` (Intelligence) and `/overlay` mappings. Never
exposed through Cloudflare/public routing.

## Payload

Standard OwnTracks HTTP-mode location JSON (`_type: "location"`), at minimum `lat`, `lon`,
`tst` (unix seconds); `acc`, `alt`, `vel`, `cog`, `batt`, `tid` used when present, ignored
(not required) when absent. Any `unit_id`-shaped field in the payload is never read -- the
server-side credential alone determines the target unit (see Auth below).

Rejected (422) when: `_type` isn't `"location"`, lat/lon missing/non-numeric/out of
[-90,90]/[-180,180], or `tst` missing/grossly invalid (before ~2023 or >5 min in the future --
a stale/misconfigured phone clock, not weakened Fabric semantics).

## Normalization into Fabric

Constructs a `FabricIngestMessage` (`schema_version 1.0.0`) with:
- `unit_id: cbwx-unit-striker`, `device_id: cbwx-striker-ops-ipad` (server-fixed, never
  client-supplied) -- reuses STRIKER's already-registered ops-ipad device (one of the two
  devices Fabric's own registry already lists as an authoritative location source for this
  unit) rather than registering a new device_id, which would require rebuilding the core-api
  package (out of scope for an adapter).
- `measurements`: `lat`, `lon`, plus `accuracy_m`/`altitude_m`/`speed_mps`/`course_deg`/
  `battery_pct` when the corresponding OwnTracks field is present.
- `transport`: `{kind: "https", path: "gatewayless", endpoint_ref: "/api/owntracks/v1/location",
  protocol_version: "owntracks-http-v1"}`.
- `metadata`: `{source: "owntracks", transport: "https", publisher: <OwnTracks tid, or a
  default>}`.
- `observed_at` = OwnTracks' own `tst` (source timestamp, preserved); `received_at` = this
  adapter's own clock at accept time -- both kept distinct, never conflated.

Fabric's own existing freshness thresholds (LIVE <=15s, DEGRADED <=60s, STALE <=300s, else
OFFLINE) and validation (`observed_at` sanity, `require_device`) are used unmodified.

## Auth

`Authorization: Bearer <token>`. One dedicated, cryptographically strong (32 random bytes,
hex-encoded) token, generated on Core, mapped in-process to exactly `cbwx-unit-striker` --
never a general-purpose credential, never capable of choosing a different unit. Adding a
second publisher (e.g. a TESSA-equivalent OwnTracks source later) means adding one more
`{token file: unit/device}` entry in `owntracks_bridge.py`, not a credential-management
system.

**Storage:** `/srv/codeblack/config/owntracks/spencer-iphone.token` on Core, owned
`root:cbwx-core`, mode `0440` (matches the existing MQTT bridge-PKI file convention). Never
committed to git, never placed in this repo, never printed in any report/log. The adapter
process (running as `cbwx-core`) reads it once at startup via group-read permission.

## Deployment

Immutable-release pattern matching radar-worker/overlay: `/srv/codeblack/releases/
owntracks-bridge/<id>/` (stdlib-only `owntracks_bridge.py`, no build step), `current` symlink,
`codeblack-owntracks-bridge.service` (hardened systemd unit: loopback-only, `ProtectSystem=
strict`, no new privileges, 128M memory cap). Restarting this service never restarts
`codeblack-core-api.service`, `codeblack-mqtt-*`, radar-worker, or the overlay.

**Rollback:** stop `codeblack-owntracks-bridge.service` (removes the ingest path entirely,
Fabric/overlay/core-api all unaffected) and/or point `current` back at the previous release
directory.

## Known, separate, disclosed gap

The production overlay (`classic-v2.html`) currently polls `GET https://ops.codeblackwx.com/
api/chase/location/public?unit_id=...` -- a DIFFERENT public endpoint from anything in this
adapter's chain. Direct testing against Core's own currently-active core-api process
(`b38f00e-soundings-v1-1`) shows it has **no `/api/chase/location/public` route at all**
(`404 Not Found` on the loopback itself) -- the structured `LOCATION_UNAVAILABLE`/
`UNIT_NOT_PUBLIC` responses seen through the public `ops.codeblackwx.com` gateway are not
served by this core-api process, and this repository's tracked Worker/Pages sources
(`workers/core-gateway`, `workers/radar-relay`) do not implement that route either -- its
actual implementation could not be located in this pass. This means the current production
overlay is **not actually reading Fabric at all** today, regardless of this adapter's health.
Fixing that gap (repointing the overlay at Fabric's real REST/WebSocket, or locating/repairing
whatever serves `/api/chase/location/public`) is a separate, un-scoped follow-up -- explicitly
not solved here to avoid guessing at unlocated infrastructure.
