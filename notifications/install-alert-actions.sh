#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" != 0 ]]; then
  echo "Run as root on Core" >&2
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if ! getent group codeblack-actions >/dev/null; then
  groupadd --system codeblack-actions
fi
if ! id -u codeblack-actions >/dev/null 2>&1; then
  useradd --system --no-create-home --gid codeblack-actions --shell /usr/sbin/nologin codeblack-actions
fi
usermod --gid codeblack-actions codeblack-actions
for parent in /srv/codeblack /srv/codeblack/services /srv/codeblack/data /srv/codeblack/config; do
  setfacl -m u:codeblack-actions:--x "$parent"
done
install -d -o root -g codeblack-actions -m 0750 /srv/codeblack/services/alert-actions
install -o root -g codeblack-actions -m 0750 "$script_dir/incident_actions.py" /srv/codeblack/services/alert-actions/incident_actions.py
install -d -o codeblack-actions -g codeblack-actions -m 0750 /srv/codeblack/data/alert-actions
install -d -o codeblack-actions -g codeblack-actions -m 0750 /srv/codeblack/config/alert-actions
for record in /srv/codeblack/data/alert-actions/state.json /srv/codeblack/data/alert-actions/audit.jsonl; do
  if [[ -f "$record" ]]; then
    chown codeblack-actions:codeblack-actions "$record"
    chmod 0640 "$record"
  fi
done
if [[ ! -f /srv/codeblack/config/alert-actions/auth.json ]]; then
  CODEBLACK_ACTIONS_AUTH=/srv/codeblack/config/alert-actions/auth.json \
    /usr/bin/python3 /srv/codeblack/services/alert-actions/incident_actions.py \
    --provision-from /srv/codeblack/config/ntfy/reader-password.txt
fi
chown codeblack-actions:codeblack-actions /srv/codeblack/config/alert-actions/auth.json
chmod 0640 /srv/codeblack/config/alert-actions/auth.json
install -o root -g root -m 0440 "$script_dir/codeblack-alert-actions.sudoers" /etc/sudoers.d/codeblack-alert-actions
/usr/sbin/visudo -cf /etc/sudoers.d/codeblack-alert-actions
install -o root -g root -m 0644 "$script_dir/codeblack-alert-actions.service" /etc/systemd/system/codeblack-alert-actions.service
systemctl daemon-reload
systemctl enable --now codeblack-alert-actions.service
ready=0
for _attempt in {1..20}; do
  if curl --fail --silent http://127.0.0.1:8796/health >/dev/null; then
    ready=1
    break
  fi
  sleep 0.3
done
if [[ "$ready" != 1 ]]; then
  systemctl status codeblack-alert-actions.service --no-pager
  exit 1
fi
tailscale serve --bg --https=443 --set-path=/alert-actions http://127.0.0.1:8796
echo "Alert actions installed on Core; no password displayed."
