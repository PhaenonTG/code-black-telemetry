#!/bin/sh
# Edge timer boot hardening: apply. Run as root on EDGE:  sudo sh apply-hardening.sh   (idempotent)
#
# Installs a 20-late-start-fix.conf drop-in on four timers (see dropins/) so a slow boot can never leave them "elapsed".
# Only the four TIMER units are restarted, never a service. The weather services are not started by hand; the script
# refuses to run while any of the four services is executing so a restart cannot overlap a running job.
set -eu
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
HERE=$(dirname "$(readlink -f "$0")")
# order matters: the publication watcher (6 min) is intended to run before the bounded ingest (8 min)
ORDER="codeblack-core-health codeblack-edge-health codeblack-weather-publication-watcher codeblack-weather-ingest"

echo "== preflight"
for t in $ORDER; do
  if systemctl is-active --quiet "$t.service"; then echo "ABORT: $t.service is running; retry when idle"; exit 1; fi
done

echo "== install drop-ins"
for t in $ORDER; do
  d=/etc/systemd/system/$t.timer.d
  mkdir -p "$d"
  install -m 0644 -o root -g root "$HERE/dropins/$t.timer.conf" "$d/20-late-start-fix.conf"
done
systemctl daemon-reload

echo "== restart the four timers (timers only)"
for t in $ORDER; do systemctl restart "$t.timer"; done
sleep 2
systemctl list-timers --no-pager 2>/dev/null | grep -E "NEXT|core-health|edge-health|publication-watcher|weather-ingest" || true
echo "applied. First runs occur at +2 / +5 / +6 / +8 min, then on the original cadence."
