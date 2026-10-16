# Project coverage assignments

Reviewed on 2026-10-15 (America/Chicago). All 47 unregistered bindings in the captured live coverage report were assigned using unit descriptions, scheduled-task actions and the relevant source documentation. No service, training job, review or OBS action was started by registration.

| Host | Service or task | Project |
| --- | --- | --- |
| core | `codeblack-aegis-feed.service` | Radar & AEGIS |
| core | `codeblack-aegis-observation.service` | Radar & AEGIS |
| core | `codeblack-aegis-observation.timer` | Radar & AEGIS |
| core | `codeblack-aegis-warning.service` | Radar & AEGIS |
| core | `codeblack-aegis-warning.timer` | Radar & AEGIS |
| core | `codeblack-chase-ingestion.service` | Chase planning & reviews |
| core | `codeblack-chase-ingestion.timer` | Chase planning & reviews |
| core | `codeblack-chase-setup-discovery.service` | Chase planning & reviews |
| core | `codeblack-chase-setup-discovery.timer` | Chase planning & reviews |
| core | `codeblack-chase-setup-ntfy.service` | Chase planning & reviews |
| core | `codeblack-chase-setup-ntfy.timer` | Chase planning & reviews |
| core | `codeblack-chase-setup-paid-review.service` | Chase planning & reviews |
| core | `codeblack-chase-setup-paid-review.timer` | Chase planning & reviews |
| core | `codeblack-core-maintenance.service` | Infrastructure & recovery |
| core | `codeblack-core-maintenance.timer` | Infrastructure & recovery |
| core | `codeblack-ddns.service` | Infrastructure & recovery |
| core | `codeblack-ddns.timer` | Infrastructure & recovery |
| core | `codeblack-goes-ingest.service` | Radar & AEGIS |
| core | `codeblack-goes-ingest.timer` | Radar & AEGIS |
| core | `codeblack-hrrr-ingest.service` | Weather intelligence |
| core | `codeblack-hurricane-watch.service` | Hurricane & tropical watch |
| core | `codeblack-hurricane-watch.timer` | Hurricane & tropical watch |
| core | `codeblack-krax-watch.service` | Radar & AEGIS |
| core | `codeblack-krax-watch.timer` | Radar & AEGIS |
| core | `codeblack-ncei-sync.service` | Weather intelligence |
| core | `codeblack-ncei-sync.timer` | Weather intelligence |
| core | `codeblack-tropical-discovery.service` | Hurricane & tropical watch |
| core | `codeblack-tropical-discovery.timer` | Hurricane & tropical watch |
| core | `codeblack-tropical-review.service` | Hurricane & tropical watch |
| core | `codeblack-tropical-review.timer` | Hurricane & tropical watch |
| core | `codeblack-tropical-systems.service` | Hurricane & tropical watch |
| core | `codeblack-tropical-systems.timer` | Hurricane & tropical watch |
| core | `codeblack-weather-forwarder.service` | Weather intelligence |
| core | `codeblack-weather-forwarder.timer` | Weather intelligence |
| core | `codeblack-wifi-boot-select.service` | Infrastructure & recovery |
| edge | `codeblack-core-health.service` | Infrastructure & recovery |
| edge | `codeblack-core-health.timer` | Infrastructure & recovery |
| edge | `codeblack-edge-health.service` | Infrastructure & recovery |
| edge | `codeblack-edge-health.timer` | Infrastructure & recovery |
| edge | `codeblack-weather-alert-control.service` | Weather intelligence |
| phaenon3 | `task:\CodeBlack Weather Radar VLM Pipeline` | Local AI & Spencer Labs |
| phaenon3 | `task:\CodeBlack-ChasePaidReview` | Chase planning & reviews |
| phaenon3 | `task:\CodeBlack-Nick-Fieldline-Recovery` | Broadcast & Producer |
| phaenon3 | `task:\CodeBlack-Nick-OBS-Visible-20261015` | Broadcast & Producer |
| phaenon3 | `task:\CodeBlack-OBS-CodeBlackLiveTest` | Broadcast & Producer |
| phaenon3 | `task:\CodeBlack-OBS-Producer-Bridge-Recovery` | Broadcast & Producer |
| phaenon3 | `task:\CodeBlack-StreamPriorityGuard` | Broadcast & Producer |

Timers and their triggered services are registered as separate signals so a healthy timer cannot conceal a failed job. The weather/radar VLM task is a controlled model-adapter pipeline and belongs to Local AI & Spencer Labs. Fieldline supplies weather/GPS to the broadcast overlay and belongs to Broadcast & Producer. The legacy OBS live-test task is retained with its observed failure state; registration does not retire or rerun it.

Chase planning/reviews and hurricane/tropical watch are separate project entries because they have independent deployed workflows and OPS workspaces. Their declared phase is DEPLOYED / PRIVATE WORKFLOWS; missing source receipts and functional qualification remain unverified.

Later coverage findings remain visible. This assignment does not suppress unknown services, stale hosts, absent checks, or health failures.

## Health repair pass — 2026-10-15

- Edge weather workers now accept the configured F00–F06 window; explicit worker service bindings expose failures alongside their timers.
- Successful enabled boot jobs require start/finish, zero exit and passing condition evidence before they count as healthy.
- Phaenon3 inventory delivery retries verified LAN SSH when Tailnet delivery fails.
- The newly discovered `CodeBlack-Stream-Prepare-Agent` task runs from the stream preparation checkout and belongs to Broadcast & Producer.
- Tropical review was enabled but stopped; its timer was started and the next local review completed successfully.
- The newest Core backup on Edge passed the existing inventory/completion-marker verification. This does not establish a restore test.
- Disabled temporary KRAX watch, disabled legacy weather forwarder, failed OBS live test, and disconnected ESP reports remain visible pending purpose/hardware verification.

- Phaenon3 Tailscale reports a coordination-server connection fault while direct IPv4/IPv6 control-plane checks and its protocol handshake succeed. Refreshing endpoint discovery did not resolve it; restarting the Windows Tailscale service requires an administrator session. No VPN/security settings were changed.
- The old OBS live test has no triggers and last failed on September 30; it was not relaunched because a test may affect live output.

- Newly installed Core `chase-auto-aegis` service/timer belong to Chase planning & reviews (private setup advisory); `tornado-potential` service/timer belong to Weather intelligence (independent environment grids). Both bindings were checked against live unit descriptions and module entrypoints.
- Repaired Edge ingest completed at 00:45 UTC: F00–F04 promoted successfully; F05/F06 were not yet published. The publication watcher completed successfully under its existing timer.
