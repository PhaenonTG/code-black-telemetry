# Edge infrastructure alert evaluator

`evaluate.py` is the source for Edge's one-shot
`codeblack-edge-alert-evaluate.service` at
`/srv/codeblack/services/edge-alerts/evaluate.py`. Its systemd timer runs about
once a minute and the existing incident state/outbox remain on Edge; do not
replace or clear them during a code release.

Alert policy:

- PHAENON3 VRAM occupancy, including >90%, is a metric, not a Discord incident.
  Full VRAM is normal for this workload. GPU probe failure, orphaned model
  runners, and blocked or unreachable learning jobs still raise incidents.
- The Edge status and functional-probe snapshots must each be updated within
  three minutes. Stale snapshots raise issues rather than leaving an old
  healthy result in place. The threshold is configurable with
  `CODEBLACK_MAX_TELEMETRY_AGE_SECONDS`.
- Existing Core/Edge reachability, failed services, backup, Edge disk, and
  fleet checks are unchanged.

Run `python3 -m unittest discover -s edge-alerts -p 'test_*.py'` before release.
Copy the tested file to Edge with a dated backup of the existing live file,
then verify the next timer cycle is healthy. Restore the backup to roll back;
do not reset alert state just to quiet notifications. The Core Status Center
continues to show raw VRAM occupancy with an informational bar.
