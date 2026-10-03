#!/bin/sh
# Keeps the read-only Status Center collector running on Edge (user crontab; no sudo). Idempotent.
D=/srv/codeblack/services/status-collector
PID=$D/collector.pid
if [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; then exit 0; fi
cd "$D" || exit 1
nohup /usr/bin/python3 collector.py --host edge >> /srv/codeblack/logs/status-collector.log 2>&1 &
echo $! > "$PID"
