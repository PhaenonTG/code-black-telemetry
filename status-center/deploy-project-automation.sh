#!/bin/sh
# Runs on Core from a staged repository bundle, through deploy_with_status.py.
set -eu
VERSION=${1:?release required}
case "$VERSION" in *[!a-zA-Z0-9_.-]*|'') exit 2 ;; esac
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
RELEASE=/srv/codeblack/releases/status-center/$VERSION
test ! -e "$RELEASE"
sudo mkdir -p "$RELEASE"
sudo cp -a /srv/codeblack/releases/status-center/current/. "$RELEASE/"
sudo install -m 0644 "$ROOT/status-center/server.py" "$ROOT/status-center/collector.py" "$ROOT/status-center/project_inventory.py" "$ROOT/status-center/project_landscape.py" "$RELEASE/"
sudo install -m 0644 "$ROOT/status-center/web/index.html" "$RELEASE/web/index.html"
sudo python3 -m py_compile "$RELEASE/server.py" "$RELEASE/collector.py" "$RELEASE/project_inventory.py" "$RELEASE/project_landscape.py"
sudo ln -sfn "$RELEASE" /srv/codeblack/releases/status-center/current
sudo systemctl restart codeblack-status-center.service
systemctl is-active --quiet codeblack-status-center.service
curl --retry 5 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:8795/api/status/projects | python3 -c 'import json,sys; p=json.load(sys.stdin); assert any(x["id"]=="ops-alerting" for x in p); assert all("registration" in x for x in p); print("project automation API verified")'
