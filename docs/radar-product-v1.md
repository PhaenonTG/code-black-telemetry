# Code Black Radar Product V1 (server-side radar)

> **BROADCAST RADAR IS SERVER-SIDE ONLY. THE CHASE APP DOES NOT RENDER RADAR.**

## Roles

| Component | Radar responsibility |
|---|---|
| **Chase app** (phone/tablet) | None. Capture, telemetry, controls only. No radar fetching, polling, decoding, WebGL layers, fades or timers. |
| **Radar product service** (Core, `codeblack-radar-product`) | Acquisition, verification, immutable frame storage, manifest, freshness state, health. Runs continuously; never triggered by a client. |
| **Overlay** (browser page today) | Consumer only. Reads the manifest, renders already-prepared server frames, shows age/state. |
| **Future native PROGRAM compositor** | Consumer only (see "Future compositor contract"). |
| **KSGF radar-worker** (Core :8787) | Unchanged single-site products (VEL/SRV/CC and single-site REF). Client-demand driven, so it is **not** a broadcast freshness authority. |

CLEAN output = camera only. PROGRAM = camera + overlay + radar. A radar failure never touches MediaMTX, Chase ingest,
the Stream Monitor or the CLEAN path; the radar service is an independent systemd unit.

## Source (verified 2026-09-28)

- **Product:** Iowa Environmental Mesonet NEXRAD CONUS composite, N0Q base reflectivity, site `USCOMP` (143/147 radars in quorum at time of check).
- **Current file:** `https://mesonet.agron.iastate.edu/data/gis/images/4326/USCOMP/n0q_0.png` (+ `n0q_0.json` pointer with `valid` time).
- **Timestamp-specific retrieval works:** `.../archive/data/YYYY/MM/DD/GIS/uscomp/n0q_YYYYMMDDHHMM.png` (used for gap-fill/restart recovery). IEM also serves `ridge::USCOMP-N0Q-YYYYMMDDHHMM` tiles and a WMS `TIME` layer; Core does not use them.
- **Geometry:** EPSG:4326, 12200 x 5400 px, 0.005 deg/pixel, west -126, north 50 (south 23, east -65). 8-bit palette PNG, palette index 0 = no echo (transparent).
- **Cadence:** 5 minutes, steady. **The file goes live about 90 s BEFORE its `valid` label** (measured 86-96 s over consecutive cycles), so the label runs ahead of generation.
- **Terms:** IEM materials are public domain / free for any lawful purpose; attribution is requested and shown in the overlay map attribution (`NWS NEXRAD via Iowa Environmental Mesonet`). No published rate limit; Core polls a ~150-byte JSON every 20 s and downloads the 3.2 MB PNG once per new frame.

## Service

- **Host/unit:** Core, `codeblack-radar-product.service` (user `cbwx-core`, hardened like the radar-worker), `127.0.0.1:8791`.
- **Exposure:** tailnet only, via Tailscale Serve mount `/radar-product` (alongside `/radar`, `/overlay`, `/monitor`). Not public.
- **Code:** `/srv/codeblack/releases/radar-product/<version>/product.py`, `current` symlink. Data: `/srv/codeblack/data/radar-product/composite/frames/<frame_id>/`.
- **Acquisition:** every 20 s read the pointer; when `valid` is newer, download, re-read the pointer (upstream replaces file and pointer non-atomically), fully decode and validate (mode, exact size, non-empty), then publish. Missing recent slots (last 12) are gap-filled from the archive, 3 per cycle. Retention 36 frames (3 h).
- **Atomic publication:** a frame is written to `.tmp-*`, fsynced, then `rename`d into place. A frame directory is either absent or complete; `.tmp-*` leftovers are removed at startup; a frame without a valid `frame.json` is never listed.

## Contract

All URLs below are relative to the service root; the tailnet mount prefixes them with `/radar-product`.

| Path | Cache-Control | Notes |
|---|---|---|
| `GET /v1/composite/latest.json` | `no-store` | Manifest. Age/state computed **per request** from immutable frame metadata and the current time, so age keeps advancing even if acquisition is wedged. |
| `GET /v1/composite/frames/<frame_id>/tiles/{z}/{x}/{y}.png` | `public, max-age=31536000, immutable` | 256 px RGBA Web Mercator tiles, z0-z10 (native at about z8; z9-z10 are nearest-neighbour upsamples). Transparent where no echo. Point sampling on palette indices, matching IEM's own tile look (verified: identical echo coverage, zero systematic offset). |
| `GET /v1/composite/frames/<frame_id>/render.png?bbox=w,s,e,n&size=WxH` | immutable | Server-rendered Web Mercator RGBA for an arbitrary lon/lat bbox and pixel size (16-3840 x 16-2160). Intended for compositors. |
| `GET /v1/composite/frames/<frame_id>/source.png` | immutable | Native 4326 palette PNG (byte-identical to upstream). |
| `GET /v1/health` | `no-store` | Worker health. `ok=false` only when freshness is CRITICAL. |

`frame_id` = observation time as `YYYYMMDDTHHMMZ` (sortable, immutable). Unknown frame -> 404; bad params -> 400.

### Manifest (`schema_version: 1`)

Top level: `schema_version, product{id,name,kind,source,cadence_seconds,attribution}, generated_time, geometry{projection_native,
projection_tiles, bounds, native_pixel_degrees, native_size, tile_size, tile_min_zoom, tile_max_zoom, no_echo},
freshness_thresholds_seconds{fresh_max,aging_max,stale_max}, frames[], latest, freshness_state, age_seconds,
pipeline_delay_seconds, next_expected_update_time, worker{...}, cache`.

- `frames[]` is ordered **oldest -> newest** (up to 12); `latest` is the last entry, always the newest COMPLETE frame.
- Each frame: `frame_id, observation_time, source_generated_time, source_received_time, processing_started_time,
  processing_completed_time, published_time, age_seconds, conservative_age_seconds, ingest_delay_seconds,
  processing_delay_seconds, publish_delay_seconds, pipeline_delay_seconds, retrieval ("current"|"archive"), assets{source_png,
  tile_template, render_template}, sha256`.
- **Timestamps:** `observation_time` is IEM's product `valid` label. `source_generated_time` is when the file went live upstream.
  `source_received_time` is when Core finished downloading it. Because the label runs ahead of generation, `ingest_delay_seconds`
  and `pipeline_delay_seconds` are normally **negative** for live frames (the file arrived before its label); that is expected, and
  `age_seconds` is clamped at 0. `conservative_age_seconds` measures from the estimated data cut-off (generated minus the source's
  own processing time) and is the pessimistic view. Frames with `retrieval: "archive"` were gap-filled later, so their delays are
  not representative of live behavior.
- **Worker health** (`worker`): `worker_state, uptime_seconds, last_source_check, last_source_valid_time, last_successful_download,
  last_successful_process, last_successful_publish, consecutive_failures, total_failures, frames_published_since_start,
  backlog_missing_frames, last_error (sanitized, no paths), last_error_time`.

## Freshness SLA

Age is measured from the observation (`valid`) time. Normal behavior: a new frame lands ~90 s before its label and the next one
lands 300 s later, so live age runs 0 to about 210-230 s (max observed 223 s across real cycles).

| State | Age (from `valid`) | Meaning | Overlay behavior |
|---|---|---|---|
| FRESH | <= 360 s | Normal, incl. ~150 s of jitter | Loop, "Live"/"Nm ago" |
| AGING | <= 660 s | One cycle missed | Loop continues, amber dot, `Nm ago - AGING` |
| STALE | <= 1200 s | Several cycles missed | Loop **freezes** on newest frame, radar dimmed to 55%, `STALE - Nm ago` |
| CRITICAL | > 1200 s | Not usable as current (a 25-minute-old frame lands here) | Radar **hidden**, `NO RADAR - Nm old`, "Radar hidden - data critically old" |

Thresholds live in the manifest (`freshness_thresholds_seconds`); consumers must use them and never hard-code their own.
Between manifest polls the overlay advances the age by local elapsed time (monotonic clock) and re-classifies with the server's
thresholds, so a dead link degrades to STALE/CRITICAL instead of freezing at "Live". Old radar is never presented as current.

## Failure behavior

- A failed cycle (source unreachable, HTTP error, timeout, truncated/corrupt/wrong-size image) records `last_error`, increments
  `consecutive_failures`, and leaves the last valid frame published unchanged. Its `observation_time` is never rewritten; its age
  simply advances through AGING -> STALE -> CRITICAL.
- Recovery is automatic: the next successful cycle ingests the newest frame, atomically advances `latest`, and freshness returns
  to FRESH. Restart recovers from disk (frames persist); any thread death exits the process so systemd restarts it.
- Tested by `radar-product/tests/fault_injection.py` (mock IEM source): freshness transitions, outage, corrupt/truncated/wrong-size
  payloads, recovery, SIGKILL + restart with stray partial directories, immutability, ordering, cache headers.

## Overlay consumer

Deployed overlay release `radar-core-v1-20260928` (base `923191e-monitor-settings-v1.1-1`; only `index.html` differs). REF now
comes from this product (panel shows `RADAR - CONUS - REF`). The overlay no longer contacts any upstream radar provider and no
longer owns REF freshness thresholds. VEL/SRV/CC (tornado/severe rotation) still use the single-site worker path, unchanged, with
the overlay's existing health handling - that is a known remaining gap (see below). Manifest URL defaults to
`<page origin>/radar-product/v1/composite/latest.json`; override with `?radarProductBase=<origin>`.

Port of the same change into the Code Black Telemetry source repo is required (`radar-product/overlay-migration/`).

## Future compositor contract (native PROGRAM / OBS replacement)

A compositor needs nothing about IEM, KSGF, Mapbox or the radar-worker:

```
loop every ~15-20 s:
  m = GET /radar-product/v1/composite/latest.json            # no-store
  if m.freshness_state == "CRITICAL": draw nothing (or a "radar unavailable" plate); continue
  frames = m.frames                                           # oldest -> newest, immutable assets
  for each frame not yet cached:
      img = GET frame.assets.render_template with {west,south,east,north} = your viewport in lon/lat, {width}x{height} = pixels
            (or fetch XYZ tiles from frame.assets.tile_template)
  animate frames oldest -> newest at your own pace; hold on the newest
  if state == "STALE": freeze on newest, dim, draw an age badge (use m.age_seconds); if "AGING": draw the age badge
  next poll: m.next_expected_update_time is advisory only
```

Everything needed to render and to decide how to render (state, age, thresholds, ordering, geometry, attribution) is in the manifest.

## Chase phone: radar removal

`src/services/radarPolicy.ts` -> `CHASE_RADAR_ENABLED = false`. With it off, Chase never starts the IEM mosaic layer, never runs the
single-site frame loader or the playback timer, never adds radar layers, and every radar network function in `services/radar.ts`
short-circuits (storm-motion and radar-endpoint polling included); radar toggles are removed from the layer UI. GPS, breadcrumb,
alerts and other map layers are untouched. Revert by setting the flag to `true` (all radar code remains, gated).
Verified in a browser harness: 0 radar requests over 25 s with the flag off vs 24 with it on (control).

## Operations

- Deploy: `sh deploy-radar-product.sh [version]` (backs up the Tailscale Serve config first). Health: `GET /radar-product/v1/health`.
- Logs: `journalctl -u codeblack-radar-product`.
- Rollback: `sudo systemctl disable --now codeblack-radar-product` and `sudo tailscale serve --https=443 --set-path=/radar-product off`;
  repoint `overlay-current` to `923191e-monitor-settings-v1.1-1`. Data is left in place.

## Known limitations / risks

- VEL/SRV/CC in the overlay still depend on the client-demand KSGF worker (single site); only composite REF is server-authoritative in V1.
- The deployed overlay's source repo (Code Black Telemetry) was not available; the change exists as a patch and a deployed release.
- Single upstream dependency (IEM). Outages degrade honestly through the freshness states; no secondary source is configured.
- The service and manifest have no authentication (tailnet-only, consistent with the other Core mounts).
- The `valid` label runs about 90 s ahead of generation; `conservative_age_seconds` exposes the pessimistic view.
