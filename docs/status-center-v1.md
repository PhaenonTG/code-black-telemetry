# Code Black System Status Center V1

Read-only observability and navigation for the whole Code Black environment: hosts, services, streaming, radar, weather, DNS,
compute, network, storage/backups, an address book and a launchpad. It is **not** a control plane (no restart/stop/deploy actions).

- **URL (tailnet only):** https://codeblack-core.tail1d0673.ts.net/status/
- **Host:** CORE. Chosen because it is Code Black operational infrastructure that stays up independently of PHAENON3 (a gaming/shared-compute
  machine) and Spencer Labs, it already hosts the Tailscale Serve mounts (monitor, overlay, radar), and no existing OPS/status page covers this.
  Edge's own dashboard was rejected as the home because its collectors are currently stopped (its data is stale) and Edge has no passwordless sudo.
- **Service:** `codeblack-status-center.service` (user `codeblack`, `127.0.0.1:8795`, hardened: NoNewPrivileges, ProtectSystem=strict, ProtectHome,
  no capabilities, MemoryMax 500M). Exposed only through Tailscale Serve mount `/status`. **No Funnel, no Cloudflare, no public exposure.**
- **Code:** `/srv/codeblack/releases/status-center/<version>/{server.py,collector.py,registry.json,web/}`, `current` symlink. Repo: `status-center/`.

## Architecture

```
browser --GET /api/status (5 s, in place)--> status backend (Core) --cached, normalized single document
                                               ^ probe scheduler (bounded thread pool, per-probe timeout + last-known value)
                                               |-- Core: in-process collector (/proc, /sys, systemctl, release symlinks) + localhost HTTP health APIs
                                               |-- Edge: collector on tailnet IP:9110 (user crontab keepalive; no sudo) + Pi-hole DNS probes
                                               |-- PHAENON3: collector on 127.0.0.1:9110 behind Tailscale Serve /status-collector, plus Media Lab /
                                               |     Image Sandbox / AI router status endpoints over tailnet HTTPS
                                               `-- HYTETOWER: reachability only (TCP 3389/22 over the tailnet)
```
The browser only ever calls the backend. Endpoints: `/api/status` (full document, schema `codeblack.status.v1`, see `status-center/SCHEMA.md`),
`/api/status/{hosts,services,network,streaming,radar,weather,ai,labs,dns,storage,links,compute,attention,summary}`, `/api/health`.

## Data sources (existing telemetry first)

Core API `/health` + sub-health; MediaMTX API (paths, SRT conns, WebRTC sessions); Stream Monitor `/api/source-health` (STRIKER/TESSA); radar
product manifest (`/radar-product/v1/composite/latest.json`) and health; radar-worker health (liveness only); Ollama; `tailscale status --json`;
Pi-hole via DNS queries (resolve, block test) and the web UI; Edge collector (systemd unit/timer states, HRRR newest-GRIB age, backup snapshots,
`functional-probes.json`, `stream.json`, `pihole -v`); PHAENON3 collector (nvidia-smi, scheduled tasks, Ollama `/api/ps`, ComfyUI queue *counts*,
AI Lab runner, weather-worker + watchdog state file) and Media Lab `/api/system|download|health`, Image Sandbox `/api/health`, AI router `/ai/health`.

## Refresh cadences

fast 8 s (MediaMTX, monitor, radar) - host 15 s (collectors, health APIs, Tailscale, TCP) - slow 60 s (Core API sub-health, DNS, versions) -
link verification 300 s. Browser polls the backend every 5 s and pauses while the tab is hidden. The backend never probes on request.

## State model

Hosts/services: `HEALTHY | DEGRADED | OFFLINE | UNKNOWN` (compute adds `BUSY/IDLE`, radar uses `FRESH/AGING/STALE/CRITICAL`, disks add
`WARNING/CRITICAL`). Unavailable metrics are `null` and render `UNKNOWN`; nothing is fabricated. Attention severity is contextual: **INFO** for
intentional states (STRIKER/TESSA offline when nobody streams, raspberrypi offline, Q4 verifying), **WARNING**, **CRITICAL**. `LIVE` streaming
requires a real publisher signal from MediaMTX/monitor, never merely a running service. A live process never makes stale data healthy
(radar product, weather freshness, Edge status files).

Disk thresholds: WARNING >= 85% used or < 25 GB free; CRITICAL >= 92% used or < 10 GB free. Backup age: WARN 36 h, CRIT 72 h. Weather ingest
freshness: fresh 90 min, aging 3 h, stale 6 h.

## Stale telemetry and failure isolation

Every probe has a timeout, a last-known value, `last_success` and `age`. **`observing`** = recent attempts (so a failure is a trustworthy current
negative, e.g. a service is down). **`stale`** = the cached successful value is older than `max(30 s, 3 x interval)`: the UI then shows
`STALE TELEMETRY`, dependent host/services go `UNKNOWN`, and last-known values are retained for display but never shown green. A dead or hanging
source affects only its own cards; the API answers from cache (measured 10 ms while a target hangs). Tested by `status-center/tests/failure_isolation.py`
(mock Edge collector killed/revived, blackholed PHAENON3 collector): 14/14.

## Security boundary

Private (tailnet) access only; GET-only; no actions; the backend binds 127.0.0.1. Collectors accept no path/URL/command from requests: what may be
read is fixed in `registry.json`. HTTP results are reduced to whitelisted `pick` fields; `len:` extracts counts only (ComfyUI queues are counted,
never read, so prompts cannot leak); GPU process names are filtered to an AI-runtime allowlist (desktop apps are never listed); secret-looking keys are
scrubbed; errors and paths are sanitized. The Core `/api/chase/v1/config` endpoint (contains a stream credential) is never proxied or linked.
The Spencer Labs section shows infrastructure status only. Pi-hole stats/gravity are UNKNOWN by decision (the v6 API needs auth); no client query
history is ever read.

## How to extend (all data-driven: `registry.json`)

Nick Mesonet WIND/WEATHER uplink cards and the alerts daemon are included. The
uplink probe uses only Core's Mesonet read token from the dedicated protected
`/srv/codeblack/config/status-center/mesonet-read.env`; never reuse the device or
admin token. The browser receives only per-role Core report ages, not readings or
coordinates. Keep these entries current whenever Mesonet firmware, receiver or
alerting architecture changes. An authorized release still needs separate OTA
verification on the physical board.

PHAENON3 VRAM occupancy is an informational capacity metric, even above 90%:
the GPU is expected to run full. Edge Discord incidents exclude the
`vram_above_90_percent` observation. GPU probe failures, orphaned runners,
and blocked learning jobs remain actionable. Edge also alerts if status or
functional-probe snapshots stop refreshing for more than three minutes.

- **Add a host:** add to `hosts[]` (`id, name, role, lan_ip, tailscale_ip, tailscale_peer`, `collector: {mode: in-process|remote|none}` and `checks`).
  For a remote collector copy `collector.py` + `registry.json`, run `collector.py --host <id>` bound to the tailnet IP or localhost, add a `collector`
  probe (`kind: collector, host: <id>`) to `probes[]`.
- **Add a service:** add to `services[]` with `host`, optional `unit` (systemd unit/timer or Windows task on a collector host), `probe` (HTTP/TCP probe id),
  `collector_http` (a local endpoint the collector polls), `fresh_file`, `release_symlink`, `urls`, `docs`, `deps`, `informational`, `critical`.
- **Add a link:** add to `links[]` (`name, purpose, host, access, url, group, verify`). `verify:true` adds a 5-minute reachability check. Never put
  credentials or secret query parameters in a URL.
- **Add a health probe:** add to `probes[]`: `http_json` (`url, pick, ok_json, accept, no_json`), `tcp`, `dns` (`queries`), `tailscale`, `collector`,
  `collector_local`. New section-specific logic goes in the matching `build_*` function in `server.py`; add fields to `SCHEMA.md` first.
- **Future** (native broadcaster, second vehicle, ntfy, more radar/AI workers, cameras, more Pi-holes): add registry entries; `streaming.broadcast`
  already carries Edge's Facebook stream state and the page is not hard-coded to two vehicles or four hosts.

## Operations

- Deploy: `sh deploy-status-center.sh [version]` (backs up the Serve config; rollback: `sudo systemctl disable --now codeblack-status-center` and
  `sudo tailscale serve --https=443 --set-path=/status off`).
- PHAENON3 collector: `status-center/windows/install-phaenon3-collector.ps1` (scheduled task `CodeBlack-StatusCollector` + Serve mount `/status-collector`).
  Rollback: `Unregister-ScheduledTask CodeBlack-StatusCollector -Confirm:$false; tailscale serve --https=443 --set-path=/status-collector off`.
- Edge collector: `status-center/edge/keepalive.sh` from the `codeblack` user crontab (`* * * * *` + `@reboot`); crontab backup saved on Edge.
- Logs: `journalctl -u codeblack-status-center`; Edge `/srv/codeblack/logs/status-collector.log`.

## Known gaps

Pi-hole stats/gravity (need an app password or an Edge helper); AI queue/active job/last request (AEGIS auth); HYTETOWER and OBS state (no telemetry
source; reachability only); a second Pi-hole (only Edge runs one; raspberrypi is offline and undocumented); HRRR product time from Core (Core API exposes
provider health only); Windows scheduled tasks registered with higher privilege (the weather worker tasks) are read through their health endpoint and
watchdog file instead; `since` on attention items means first observed since the backend last restarted; the Edge dashboard/status files are stale
(collectors stopped) and are deliberately not consumed.

## Change log and AEGIS integration (added)

- `GET /api/changes` (alias `/api/status/changes`, `?limit=`) returns `codeblack.status.changes.v1`: debounced (12 s) state transitions, persisted in `STATUS_CENTER_STATE_DIR` (default `/srv/codeblack/data/status-center`, in the unit's `ReadWritePaths`; created by `deploy-status-center.sh`). Recording starts after probe warm-up so cold start does not produce transitions.
- AEGIS (PHAENON3 router) consumes `/api/status` and `/api/changes` read-only through one adapter. The Status Center is the authoritative monitoring/normalization plane; AEGIS is the reasoning plane and never probes or remediates. The AI section shows the adapter state, last sync and ops-context schema, taken from AEGIS's `/ai/health`. The Status Center's own health does not depend on AEGIS. Details: `services/ai-router/docs/STATUS_CENTER_INTEGRATION.md` on PHAENON3.
