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
