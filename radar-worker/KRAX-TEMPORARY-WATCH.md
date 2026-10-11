# Temporary KRAX watch (2026-10-11)

This is an operator-directed emergency configuration on Core. Do not restore
automatic site selection until the operator authorizes it.

- Before the change, the worker was in `AUTO` mode, the default selected site
  was KSRX, and no `CODEBLACK_RADAR_SITE` environment override existed.
- Original control settings were
  `{"primary_prewarm_enabled":true,"primary_interval_seconds":300,"secondary_prewarm_enabled":false}`.
- Exact original control file:
  `/srv/codeblack/data/radar-worker/radar-control.pre-krax-20261011T160847Z.json`.
- Exact original site catalog:
  `/srv/codeblack/releases/radar-worker/v1/sites.cjs.pre-krax-20261011T160847Z`.
- Temporary site override:
  `/etc/systemd/system/codeblack-radar-worker.service.d/90-krax-temporary.conf`.
- Temporary completed-volume watcher:
  `codeblack-krax-watch.timer` / `codeblack-krax-watch.service`.
- Durable watcher records:
  `/srv/codeblack/data/radar-worker/krax-watch/scans.jsonl` and `state.json`.
  Each complete Level II volume key is processed once; a crash between log append
  and state update is reconciled from the log.

The timer checks the archive 15 seconds after each completed check, then
examines every newly listed complete volume in key order (up to four per run).
It records moment availability across the lowest five cuts and screens
REF/CC on the lowest suitable cut with VEL/SW on a same-volume cut only when
its elevation differs by no more than 0.2 degree, warning polygon feed state,
screened candidate couplets, limitations, and confidence. SRV is unavailable
unless actual storm motion is configured. This is a conservative candidate
screen, not an operational tornado or debris-signature confirmation.

## Authorized rollback

After explicit operator authorization, on Core:

```sh
sudo systemctl disable --now codeblack-krax-watch.timer
sudo mv /etc/systemd/system/codeblack-radar-worker.service.d/90-krax-temporary.conf /etc/systemd/system/codeblack-radar-worker.service.d/90-krax-temporary.conf.disabled
sudo cp -p /srv/codeblack/data/radar-worker/radar-control.pre-krax-20261011T160847Z.json /srv/codeblack/data/radar-worker/radar-control.json
sudo systemctl daemon-reload
sudo systemctl restart codeblack-radar-worker.service
curl -fsS http://127.0.0.1:8787/api/v1/radar/status
```

Confirm `siteMode` is `AUTO`, the control status reports prewarming
`ACTIVE`, and the radar worker remains healthy. The KRAX catalog entry is
benign and can remain; the preserved original catalog is available if an exact
file rollback is needed.
