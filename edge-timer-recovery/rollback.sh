#!/bin/sh
# Edge timer recovery: rollback to the pre-repair unit definitions.
# Run as root on EDGE:  sudo sh rollback.sh [--restore-held]
# NOTE: this returns the six timers to their ORIGINAL (stall-prone) definition; after a timer restart they will sit in
# "elapsed" again. Running timers keep their current schedule until restarted. --restore-held puts the held stale
# notification(s) back in the outbox.
set -eu
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
for t in codeblack-edge-status-collect codeblack-fleet-presence codeblack-edge-alert-evaluate codeblack-edge-reliability codeblack-notification-dispatch codeblack-ops-infrastructure; do
  rm -f "/etc/systemd/system/$t.timer.d/20-late-start-fix.conf"
  rmdir "/etc/systemd/system/$t.timer.d" 2>/dev/null || true
done
systemctl daemon-reload
if [ "${1:-}" = "--restore-held" ]; then
  mv -n /srv/codeblack/data/notifications/held-stale-20260929/* /srv/codeblack/data/notifications/outbox/ 2>/dev/null || true
fi
echo "rolled back (drop-ins removed, daemon-reloaded)."
