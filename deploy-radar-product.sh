#!/usr/bin/env sh
# Deploy radar-product/ to Core as codeblack-radar-product.service (tailnet-only via /radar-product).
# Run from the dev machine; needs Tailscale SSH access to `codeblack-core` (same as deploy-radar-worker.sh).
#
# Layout on Core (matches existing conventions):
#   /srv/codeblack/releases/radar-product/<version>/product.py   immutable release dirs
#   /srv/codeblack/releases/radar-product/current -> <version>   switched atomically
#   /srv/codeblack/data/radar-product/                           frames + manifest (owner cbwx-core)
#   /srv/codeblack/backups/radar-product-<stamp>/                pre-change tailscale-serve + unit backups
#
# ROLLBACK (leaves data in place):
#   sudo systemctl disable --now codeblack-radar-product
#   sudo tailscale serve --https=443 --set-path=/radar-product off
#   # previous serve config is saved as serve-status.json in the backup dir above
set -eu

CORE_HOST="${CODEBLACK_CORE_HOST:-codeblack-core}"
VERSION="${1:-v1-$(date -u +%Y%m%d-%H%M%S)}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
cd "$(dirname "$0")/radar-product"

echo "== Uploading release $VERSION to $CORE_HOST =="
scp product.py "$CORE_HOST:/tmp/radar-product.product.py"
scp codeblack-radar-product.service "$CORE_HOST:/tmp/codeblack-radar-product.service"

ssh "$CORE_HOST" "VERSION='$VERSION' STAMP='$STAMP' sh -s" <<'REMOTE'
set -eu
REL=/srv/codeblack/releases/radar-product
DATA=/srv/codeblack/data/radar-product
BK=/srv/codeblack/backups/radar-product-$STAMP

sudo mkdir -p "$BK" "$REL/$VERSION" "$DATA"
sudo tailscale serve status --json > /tmp/serve-status.json 2>/dev/null || echo '{}' > /tmp/serve-status.json
sudo cp /tmp/serve-status.json "$BK/serve-status.json"
[ -f /etc/systemd/system/codeblack-radar-product.service ] && sudo cp /etc/systemd/system/codeblack-radar-product.service "$BK/" || true
[ -L "$REL/current" ] && readlink "$REL/current" | sudo tee "$BK/previous-release.txt" >/dev/null || true

sudo install -m 0644 -o root -g root /tmp/radar-product.product.py "$REL/$VERSION/product.py"
sudo ln -sfn "$REL/$VERSION" "$REL/current"
sudo chown -R cbwx-core:cbwx-core "$DATA"
sudo chmod 0750 "$DATA"
sudo install -m 0644 -o root -g root /tmp/codeblack-radar-product.service /etc/systemd/system/codeblack-radar-product.service
sudo systemctl daemon-reload
sudo systemctl enable codeblack-radar-product >/dev/null 2>&1
sudo systemctl restart codeblack-radar-product

# tailnet-only mount, alongside the existing /radar, /overlay, /monitor mounts (not publicly exposed)
sudo tailscale serve --bg --set-path=/radar-product http://127.0.0.1:8791 >/dev/null
sleep 3
systemctl is-active codeblack-radar-product
curl -s -m 8 http://127.0.0.1:8791/v1/health | head -c 300; echo
REMOTE
echo "== done (backup: /srv/codeblack/backups/radar-product-$STAMP) =="
