#!/bin/sh
# Edge timer boot hardening: rollback. Run as root on EDGE:  sudo sh rollback-hardening.sh
# Removes the four drop-ins and reloads systemd. Running timers keep their current schedule until restarted; after a
# restart they return to the ORIGINAL definition (OnBootSec-based, still slow-boot sensitive).
# The six-timer recovery drop-ins are NOT touched by this script.
set -eu
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
for t in codeblack-core-health codeblack-edge-health codeblack-weather-publication-watcher codeblack-weather-ingest; do
  rm -f "/etc/systemd/system/$t.timer.d/20-late-start-fix.conf"
  rmdir "/etc/systemd/system/$t.timer.d" 2>/dev/null || true
done
systemctl daemon-reload
echo "rolled back (four drop-ins removed, daemon-reloaded)."
