# Code Black System Status Center - status schema `codeblack.status.v1`

Single aggregated document served by the backend at `GET /api/status` (no-store). The browser never polls hosts directly.
Rules for consumers: **every metric is nullable; null renders as `UNKNOWN`, never 0 or blank**. Anything with a `telemetry`
block whose `stale` is true must NOT be shown green (render `STALE TELEMETRY`). Never render raw HTML from any string field.

## Enums
- `state` (hosts, services, generic): `HEALTHY | DEGRADED | OFFLINE | UNKNOWN` (compute may also use `BUSY`)
- `freshness` (radar): `FRESH | AGING | STALE | CRITICAL` (or `NOT_AVAILABLE`)
- `severity` (attention): `INFO | WARNING | CRITICAL`
- `access` (links): `TAILSCALE | LAN | LOCAL ONLY | PUBLIC | EXTERNAL ADMIN`
- `path` (network): `direct | relayed | unreachable | unknown` (a host's own path is `self`)
- `telemetry`: `{observed_at: ISO|null, last_success: ISO|null, age_s: number|null, max_age_s: number, stale: boolean}`

## Top level
```
{ schema, generated_at, backend, summary, attention[], hosts[], services[], streaming, radar, weather, dns, ai, labs,
  compute, network, storage, notifications, links[], address_book[] }
```
- `backend`: `{version, host, uptime_s, probes_total, probes_stale, probes_failing, refresh_hints:{fast_s, host_s, slow_s}}`
- `summary`: `{overall: state, attention_count, tiles:[{id, label, state, detail, group:"host"|"domain", informational}]}` (`informational:true` = intentional idle state, e.g. nobody is streaming)
  Tiles include one per host (group host) and domain tiles: RADAR (freshness), WEATHER, DNS, STREAMING, AI, LABS, STORAGE, NETWORK.
- `attention[]`: `{id, severity, title, detail, source, since, link|null, operator:{acknowledged_at?, snoozed_until?}}` sorted CRITICAL, WARNING, INFO. Intentional states
  (e.g. TESSA/STRIKER offline when nobody streams) are INFO only.

## notifications
`{server:{url, access, authentication, retention_days, service, state, last_success},
  channels:[{topic, purpose, cadence_s, service, state, last_success}],
  actions:{service, state, last_success},
  fallback:{service, state, last_success},
  iphone:{inbox:"CONFIRMED", push:"CONFIRMED", note}}`
Server/channel/fallback states come from the corresponding live service cards. The iPhone
fields record a manual operator observation, not a live device probe. No
credentials, tokens, or message text appear in this object.

## hosts[]
`{id, name, role, state, state_reason, lan_ip, tailscale_ip, os, uptime_s,
  cpu:{model, cores, load1, percent}, memory:{used_mb, total_mb, percent},
  disks:[{mount, used_gb, total_gb, free_gb, percent, state}], temperature_c,
  gpu:{name, vram_used_mb, vram_total_mb, utilization, temperature_c}|null,
  last_contact, path, collector:"in-process"|"remote"|"none", telemetry, links:[{name,url}]}`

## services[]
`{id, name, host, category, role, state, state_reason, informational, version, release, uptime_s, last_success, last_error,
  dependencies:[service ids], urls:{local, tailscale, public, manage, health}, docs, metrics:[{label,value}], telemetry}`
`docs` is a display string/path (metadata), not a link. `informational:true` = an intentional/expected state (not a fault).
`host_impact:false` in a service registry entry keeps a remote/device fault from degrading the host that observes it; the service itself still raises dashboard attention.
Nick Mesonet WIND and WEATHER are service cards under Core. Their state is based on
Core's authenticated read-only `received_age_ms`: <=5 s HEALTHY, 5–30 s DEGRADED,
>=30 s OFFLINE. If the read probe fails, state is UNKNOWN, never green from cached
data. Only role and report age are retained; sensor values, GPS and credentials
are not present in status-center responses. These states measure transport, not
sensor calibration or physical wiring.

## streaming
`{state:"LIVE"|"OFFLINE"|"DEGRADED"|"UNKNOWN", summary,
  sources:[{id, name, aliases:[], state:"LIVE"|"OFFLINE"|"DEGRADED"|"UNKNOWN", reason, publisher_online, readers, codec,
            resolution, bitrate_kbps, source_age_s, reconnect:{state, detail}|null, informational_offline}],
  ingest:{srt:{state, connections, port}, webrtc:{state, sessions}},
  mediamtx:{state, version, paths:[{name, ready, readers, tracks, bytes_received, source_type}]},
  monitor:{state, url}, broadcast:null|{state, detail}, telemetry}`
LIVE requires a real publisher signal (`publisher_online` true), never merely a running service.

## radar
`{state:freshness|"NOT_AVAILABLE", product:{name, source, cadence_s}|null,
  latest:{frame_id, observation_time, source_received_time, published_time, age_s, pipeline_delay_s}|null,
  manifest_health:{ok, observed_at, age_s}, worker:{state, version, consecutive_failures, last_error},
  legacy_worker:{state, note}, link, telemetry}`
A live process does not make stale radar healthy.

## weather
`{state, items:[{id, name, host, state, last_product_time, last_success, age_s, max_age_s, error, note}], telemetry}`

## dns
`{state, note, instances:[{id, name, host, lan_ip, tailscale_ip, dns_port, web_status, ftl_status, state,
   checks:[{name, ok, detail, latency_ms}], version:{core, web, ftl}|null, stats:null|{queries_today, blocked_today, percent_blocked},
   gravity:null|{domains, lists, last_update}, dashboard_urls:[{label, url, access}], telemetry}]}`
No client query history is ever included.

## ai
`{state, note, items:[{id, name, state, detail:[{label,value}]}], model_loaded, queue_depth, active_job, last_request, telemetry}`

## labs (Spencer Labs - infrastructure only, visually separated)
`{state, note, items:[{id, name, state, url, detail:[{label,value}]}],
  download:{model, bytes_downloaded, bytes_total, percent, rate_bps, state, retries, last_progress_at, integrity}|null, telemetry}`

## compute (shared GPU host)
`{host, state:"IDLE"|"BUSY"|"UNKNOWN"|"OFFLINE", gpu:{name, vram_used_mb, vram_total_mb, vram_free_mb, utilization, temperature_c}|null,
  owner:string|null, jobs:{image:{state,detail}, media:{state,detail}, ai:{state,detail}}, admission:{state,detail}, contention:string|null, telemetry}`
`owner` is null unless it can actually be determined.

## network
`{tailscale:{state, backend, self_ip, tailnet},
  peers:[{id, name, tailscale_ip, online, path, relay, last_seen, latency_ms}],
  pairs:[{from, to, state, latency_ms, path}], internet:{state, detail}, telemetry}`

## storage
`{state, hosts:[{host, disks:[{mount, used_gb, total_gb, free_gb, percent, state}]}],
  backups:[{id, name, host, state, last_backup, age_s, last_verification, detail:[{label,value}]}], telemetry}`

`last_backup` and `age_s` identify the exact snapshot named by a healthy, complete
verification report. A newer dated directory alone cannot advance them or make the
backup healthy. `detail` distinguishes the newest directory from the verified
snapshot; a mismatch is degraded until that exact snapshot is verified.
Disk state thresholds: HEALTHY, WARNING (>=85% used or <25 GB free), CRITICAL (>=92% used or <10 GB free) - rendered via `state`
values `HEALTHY | WARNING | CRITICAL | UNKNOWN`.

## links[] and address_book[]
`links: [{id, name, purpose, host, access, url, group, verified:{ok, status, checked_at}|null}]`
`address_book: [{name, host, lan, tailscale, url, purpose, access}]`
URLs never contain credentials or query secrets.
