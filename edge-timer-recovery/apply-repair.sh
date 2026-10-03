#!/bin/sh
# Edge timer recovery: apply. Run as root on EDGE:  sudo sh apply-repair.sh   (idempotent)
#
# Re-anchors the six stalled boot-relative timers to timer activation (see dropins/*.conf) and holds the one stale
# notification that would otherwise be sent to Discord after a 22h gap. Only timers are restarted; no service is
# started by hand, Pi-hole/weather/Discord units are not touched.
set -eu
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
HERE=$(dirname "$(readlink -f "$0")")
HOLD=/srv/codeblack/data/notifications/held-stale-20260929
ORDER="codeblack-edge-status-collect codeblack-fleet-presence codeblack-edge-alert-evaluate codeblack-edge-reliability codeblack-notification-dispatch codeblack-ops-infrastructure"

echo "== preflight"
getent hosts discord.com >/dev/null || { echo "ABORT: DNS cannot resolve discord.com"; exit 1; }
tailscale status >/dev/null 2>&1 || { echo "ABORT: tailscale not healthy"; exit 1; }
for t in $ORDER; do
  if systemctl is-active --quiet "$t.service"; then echo "ABORT: $t.service is running"; exit 1; fi
done

echo "== hold stale notification(s) older than 30 min (a 22h-old false 'Core unreachable' alert must not reach Discord)"
mkdir -p "$HOLD"
chown codeblack:codeblack "$HOLD"
find /srv/codeblack/data/notifications/outbox -type f -mmin +30 -print -exec mv -n {} "$HOLD"/ \;

echo "== install drop-ins"
for t in $ORDER; do
  d=/etc/systemd/system/$t.timer.d
  mkdir -p "$d"
  install -m 0644 -o root -g root "$HERE/dropins/$t.timer.conf" "$d/20-late-start-fix.conf"
done
systemctl daemon-reload

echo "== restart timers in dependency order (timers only)"
for t in $ORDER; do systemctl restart "$t.timer"; done
sleep 2
systemctl list-timers --no-pager 2>/dev/null | grep -E "NEXT|status-collect|fleet-presence|alert-evaluate|edge-reliability|notification-dispatch|ops-infrastructure" || true
echo "applied. First runs occur within ~30-55 s, then every 60 s."
