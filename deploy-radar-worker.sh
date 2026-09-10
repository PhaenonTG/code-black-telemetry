#!/usr/bin/env sh
# Deploy radar-worker/worker.cjs to Core and restart it.
#
# Run this from your DEV MACHINE (e.g. your laptop, or wherever this repo is checked out) --
# it scp's the file to Core over Tailscale SSH and restarts the service remotely. It does NOT
# need to run on Core itself.
#
# Confirmed live against the real Core host (2026-09-10), not guessed:
#   - Host: codeblack-core (100.96.77.89 on the codeblackwx@gmail.com tailnet)
#   - Service: codeblack-radar-worker.service (systemd, WorkingDirectory=/srv/codeblack/releases/radar-worker/v1)
#   - The release dir is NOT a git checkout -- it's plain deployed files. Previous updates were
#     done the same way this script does it: copy the new worker.cjs in, keep a timestamped
#     backup of the old one. There's no separate "pull" step because there's nothing to pull from
#     on Core -- this repo's the source of truth, Core just holds a deployed copy.
#   - worker.cjs on Core is owned cbwx-core:cbwx-core, mode 640 -- the SSH user (`codeblack`) has
#     passwordless sudo, used below only to preserve that exact ownership/mode on the new file
#     and to restart the service, nothing broader.
#   - Health endpoint: /api/v1/radar/health
#
# Requires the `codeblack-core` Host entry already in your ~/.ssh/config (HostName 100.96.77.89,
# User codeblack) and Tailscale connected. Uses scp+ssh, so also works with:
#   CODEBLACK_CORE_HOST=codeblack@100.96.77.89 ./deploy-radar-worker.sh
# if you're running from a machine without that SSH config entry.
set -eu

CORE_HOST="${CODEBLACK_CORE_HOST:-codeblack-core}"
RELEASE_DIR="/srv/codeblack/releases/radar-worker/v1"
SERVICE_NAME="codeblack-radar-worker"

cd "$(dirname "$0")"
LOCAL_FILE="radar-worker/worker.cjs"
if [ ! -f "$LOCAL_FILE" ]; then
  echo "Can't find $LOCAL_FILE from $(pwd) -- run this from the repo root." >&2
  exit 1
fi

echo "== Uploading $LOCAL_FILE to $CORE_HOST:/tmp/ =="
scp "$LOCAL_FILE" "$CORE_HOST:/tmp/worker.cjs.new"

echo "== Backing up current file, installing new one, restarting on $CORE_HOST =="
# shellcheck disable=SC2087
ssh "$CORE_HOST" bash <<REMOTE
set -eu
STAMP=\$(date -u +%Y%m%dT%H%M%SZ)
BACKUP="$RELEASE_DIR/worker.cjs.backup-\$STAMP"
echo "Backing up current worker.cjs -> \$BACKUP"
sudo cp "$RELEASE_DIR/worker.cjs" "\$BACKUP"
echo "Installing new worker.cjs (preserving cbwx-core:cbwx-core, mode 640)"
sudo install -o cbwx-core -g cbwx-core -m 640 /tmp/worker.cjs.new "$RELEASE_DIR/worker.cjs"
rm -f /tmp/worker.cjs.new
echo "Restarting $SERVICE_NAME"
sudo systemctl restart $SERVICE_NAME
sleep 2
sudo systemctl status $SERVICE_NAME --no-pager -l | head -15
echo "== Health check =="
curl -sf http://localhost:8787/api/v1/radar/health && echo || {
  echo "Health check failed -- check: journalctl -u $SERVICE_NAME -n 50" >&2
  echo "Rollback: sudo install -o cbwx-core -g cbwx-core -m 640 \$BACKUP $RELEASE_DIR/worker.cjs && sudo systemctl restart $SERVICE_NAME" >&2
  exit 1
}
REMOTE
