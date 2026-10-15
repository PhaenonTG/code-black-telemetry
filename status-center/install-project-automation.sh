#!/bin/sh
# Run from an uploaded repository bundle on Core or Edge. Administrative setup.
set -eu
HOST_ID=${1:?core or edge required}
case "$HOST_ID" in core|edge) ;; *) exit 2 ;; esac
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
if [ "$HOST_ID" = core ]; then
  sudo install -d -m 0755 /srv/codeblack/services/project-landscape /srv/codeblack/config/project-landscape/projects.d
  sudo install -m 0644 "$ROOT/status-center/project_inventory.py" /srv/codeblack/services/project-landscape/project_inventory.py
  for manifest in "$ROOT"/.codeblack/projects/*.json; do
    sudo python3 /srv/codeblack/services/project-landscape/project_inventory.py register < "$manifest" >/dev/null
  done
fi
if [ "$HOST_ID" = edge ]; then
  install -d -m 0750 /srv/codeblack/services/project-landscape/config/projects.d /srv/codeblack/services/project-collector /srv/codeblack/data/status-collector
  install -m 0644 "$ROOT/status-center/project_inventory.py" /srv/codeblack/services/project-landscape/project_inventory.py
  for manifest in "$ROOT"/.codeblack/projects/*.json; do
    python3 /srv/codeblack/services/project-landscape/project_inventory.py register --config /srv/codeblack/services/project-landscape/config < "$manifest" >/dev/null
  done
  install -m 0644 "$ROOT/status-center/collector.py" "$ROOT/status-center/project_inventory.py" /srv/codeblack/services/project-collector/
  install -d -m 0755 "$HOME/.config/systemd/user"
  install -m 0644 "$ROOT/status-center/codeblack-project-collector-user.service" "$HOME/.config/systemd/user/codeblack-project-collector.service"
  # Retain the old files and cron entries for rollback. Cron must not compete
  # with the managed service for the existing collector port.
  if [ ! -e /srv/codeblack/services/status-collector/keepalive.pre-project-automation.sh ]; then
    cp -p /srv/codeblack/services/status-collector/keepalive.sh /srv/codeblack/services/status-collector/keepalive.pre-project-automation.sh
  fi
  install -m 0755 "$ROOT/status-center/project-collector-keepalive.sh" /srv/codeblack/services/status-collector/keepalive.sh
  systemctl --user daemon-reload
  systemctl --user enable codeblack-project-collector.service
  loginctl enable-linger "$(id -un)" 2>/dev/null || true
  # The exact legacy command was verified before migration. Never terminate
  # unrelated Python processes or other collectors.
  pgrep -f '^/usr/bin/python3 collector.py --host edge$' | xargs -r kill
  systemctl --user restart codeblack-project-collector.service
  systemctl --user is-active codeblack-project-collector.service
fi
