#!/usr/bin/env sh
# Deploy status-center/ to Core as codeblack-status-center.service (tailnet-only via /status).
# Layout: /srv/codeblack/releases/status-center/<version>/{server.py,collector.py,registry.json,web/}, `current` symlink.
# ROLLBACK: sudo systemctl disable --now codeblack-status-center; sudo tailscale serve --https=443 --set-path=/status off
#           (previous serve config saved under /srv/codeblack/backups/status-center-<stamp>/)
set -eu
CORE_HOST="${CODEBLACK_CORE_HOST:-codeblack-core}"
VERSION="${1:-v1-$(date -u +%Y%m%d-%H%M%S)}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
cd "$(dirname "$0")/status-center"
ssh "$CORE_HOST" "rm -rf /tmp/sc-release && mkdir -p /tmp/sc-release/web"
scp -q server.py collector.py registry.json "$CORE_HOST:/tmp/sc-release/"
scp -q web/index.html "$CORE_HOST:/tmp/sc-release/web/"
scp -q codeblack-status-center.service "$CORE_HOST:/tmp/codeblack-status-center.service"
ssh "$CORE_HOST" "VERSION='$VERSION' STAMP='$STAMP' sh -s" <<'REMOTE'
set -eu
REL=/srv/codeblack/releases/status-center; BK=/srv/codeblack/backups/status-center-$STAMP
sudo mkdir -p "$BK" "$REL/$VERSION"
sudo mkdir -p /srv/codeblack/data/status-center && sudo chown codeblack:codeblack /srv/codeblack/data/status-center && sudo chmod 0750 /srv/codeblack/data/status-center
sudo tailscale serve status --json > /tmp/serve-status-sc.json 2>/dev/null || echo '{}' > /tmp/serve-status-sc.json
sudo cp /tmp/serve-status-sc.json "$BK/serve-status.json"
[ -L "$REL/current" ] && readlink "$REL/current" | sudo tee "$BK/previous-release.txt" >/dev/null || true
sudo cp -r /tmp/sc-release/. "$REL/$VERSION/"
sudo chown -R root:root "$REL/$VERSION"; sudo chmod -R a+rX "$REL/$VERSION"
sudo ln -sfn "$REL/$VERSION" "$REL/current"
sudo install -m 0644 -o root -g root /tmp/codeblack-status-center.service /etc/systemd/system/codeblack-status-center.service
sudo systemctl daemon-reload && sudo systemctl enable codeblack-status-center >/dev/null 2>&1 && sudo systemctl restart codeblack-status-center
sudo tailscale serve --bg --set-path=/status http://127.0.0.1:8795 >/dev/null
sleep 6
systemctl is-active codeblack-status-center
curl -s -m 8 http://127.0.0.1:8795/api/health; echo
echo "funnel status:"; sudo tailscale funnel status 2>&1 | head -3
REMOTE
echo "== done (backup: /srv/codeblack/backups/status-center-$STAMP)"
