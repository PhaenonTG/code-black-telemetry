# Automatic project and deployment inventory

Core and Edge collect installed and loaded `codeblack*.service` and
`codeblack*.timer` units every 60 seconds. Core merges their inventories into its
status feed; OPS refreshes that feed every 30 seconds. Discovered services appear
even if a deployment did not use the reporting wrapper. A stopped/offline host
cannot supply new inventory; retained observations become UNKNOWN after 180
seconds instead of staying green. Phaenon3's existing collector does not yet
support this Linux inventory and is shown as unavailable for discovery.

## Register a project

Keep a `codeblack.project.v1` JSON file in `.codeblack/projects/`. Existing
manifests are examples. Required fields are schema, id, name and summary.
Services declare id, host, name, and an optional systemd unit. Existing service
IDs retain their functional probes. New units initially have process/schedule
checks only, which OPS labels explicitly. Links are metadata, never probe targets.

Deploy tooling installs the manifest into
`/srv/codeblack/config/project-landscape/projects.d/` on Core, or
`/srv/codeblack/services/project-landscape/config/projects.d/` on Edge.
Collectors load it automatically. Registration-only projects can be published
through the installed helper's `register` command over SSH, with JSON on stdin.
No dashboard restart or browser build is needed for new entries.

## Report a deployment

```sh
python3 scripts/deploy_with_status.py \
  --host codeblack-core --host-id core \
  --manifest .codeblack/projects/ops-alerting.json \
  --unit codeblack-status-center \
  --release status-center/your-release \
  -- sh your-deployment-script.sh
```

The wrapped command must include the deployment's functional verification.
It runs using the existing SSH access; no API key or public write endpoint is
added. The helper records the Git commit, dirty-checkout flag, unique attempt,
release and started/succeeded/failed result. Failed deployment commands remain
visible even while the previous version is healthy. Interrupted commands that
cannot finish reporting remain DEPLOYING, which needs investigation.

Commit source before deploying. Dirty deployments are recorded but cannot
qualify as VERIFIED. A clean receipt must match both the observed release and a
bounded metadata fingerprint of its entry files. In-place changes therefore
invalidate an older receipt. The scanner does not guess a commit or deployment
time from a directory name or service restart. Rollback is a new deployment
attempt targeting the restored release; report its original source commit with
a clean checkout of that revision.

The existing Core Status Center and radar deployment scripts use this wrapper.
Private OPS has `web/ops/scripts/deploy-private-ops.ps1`, which builds with the
private sign-in configuration, installs an immutable release, checks its served
entry page and records the result. Other deployment methods automatically
appear as discoveries; migrate them to the wrapper to retain exact source and
attempt outcomes.

## Health, milestones and coverage

Planning milestones remain declared metadata. A LIVE phase is displayed as
UNVERIFIED until deployment receipts and current health evidence qualify it.
Process checks do not establish functional application correctness. Existing
registered functional checks remain the operational health authority.

Coverage findings include unregistered units, monitored services without a
project, missing declared units, manifest errors, and discovery gaps. Scheduled
services covered by their registered timers are not duplicated. Previously
unknown one-shot jobs are not marked healthy unless a successful observed run
and active schedule are both available.

Core receipts live in the root-owned
`/srv/codeblack/config/project-landscape/deployments.json`. Edge receipts live in
`/srv/codeblack/services/project-landscape/config/deployments.json`, protected by
its existing service account and directory permissions. Each unit retains
20 reports, with a maximum of 256 units. Collector state retains the last
inventory and 100 observed release changes. These are small metadata records;
existing heavy sensor, incident and GPIO logs continue using Edge storage.
No source, environment values, prompts, secrets or log contents are exposed.

## Installation and rollback

Install `project_inventory.py` as
`/srv/codeblack/services/project-landscape/project_inventory.py` on Core/Edge,
owned by root on Core and by its deployment account on Edge. Install project
manifests under the corresponding config directory. Include `project_inventory.py` and `project_landscape.py` in Core's
Status Center release. Edge's managed `codeblack-project-collector.service`
is a user service using the existing registry and port, replacing its legacy
background collector. Its existing cron/@reboot entry can recover the collector
even when the user manager is unavailable. System and user Code Black units are
both included in discovery.

Retain the previous Core release and private OPS override for rollback. Edge's
previous collector files remain in `services/status-collector`; its cron
keepalive uses the managed collector when available. To roll back Edge,
disable/stop the user service and restore/run
`services/status-collector/keepalive.pre-project-automation.sh`.
