#!/usr/bin/env bash
# Guarded Status Center release: fresh peer evidence and honest reachability-only UI.
set -euo pipefail

archive=${1:?archive required}
expected_server=${2:?server sha required}
expected_web=${3:?web sha required}
previous_server=64b5a11fd487c5b83160c6b96ac4e2315f8c5f69ce796bc3555d7a226769d3e0
previous_web=85a43888c8e0ef575ae4215d4e497b73d882f85fcd079e0501861eaac889de8a
release_root=/srv/codeblack/releases/status-center
current=$release_root/current

[[ $(id -u) -eq 0 && $(hostname -s) == codeblack-core ]] || { echo 'Wrong deployment host or user'; exit 1; }
[[ $archive == /tmp/status-center-reachability-*.tar ]] || { echo 'Unexpected archive path'; exit 1; }
[[ $expected_server =~ ^[0-9a-f]{64}$ && $expected_web =~ ^[0-9a-f]{64}$ ]] || { echo 'Invalid hash'; exit 1; }
[[ $(tar -tf "$archive" | sort) == $'server.py\nweb/index.html' ]] || { echo 'Unexpected package members'; exit 1; }
[[ $(tar -xOf "$archive" server.py | sha256sum | cut -d' ' -f1) == "$expected_server" ]] || { echo 'Server package hash mismatch'; exit 1; }
[[ $(tar -xOf "$archive" web/index.html | sha256sum | cut -d' ' -f1) == "$expected_web" ]] || { echo 'Web package hash mismatch'; exit 1; }
[[ -L $current ]] || { echo 'Current release link missing'; exit 1; }
previous=$(readlink -f -- "$current")
[[ $previous == "$release_root/"* && -f $previous/server.py && -f $previous/web/index.html ]] || { echo 'Unexpected release target'; exit 1; }
[[ $(sha256sum "$previous/server.py" | cut -d' ' -f1) == "$previous_server" ]] || { echo 'Production server drift'; exit 1; }
[[ $(sha256sum "$previous/web/index.html" | cut -d' ' -f1) == "$previous_web" ]] || { echo 'Production web drift'; exit 1; }

stamp=$(date -u +%Y%m%dT%H%M%SZ)
next=$release_root/reachability-$stamp
[[ ! -e $next ]] || { echo 'Release path exists'; exit 1; }
mkdir "$next"
cp -a "$previous/." "$next/"
tar -xf "$archive" -C "$next" server.py web/index.html
[[ $(sha256sum "$next/server.py" | cut -d' ' -f1) == "$expected_server" ]] || { echo 'Staged server hash mismatch'; exit 1; }
[[ $(sha256sum "$next/web/index.html" | cut -d' ' -f1) == "$expected_web" ]] || { echo 'Staged web hash mismatch'; exit 1; }
python3 -m py_compile "$next/server.py" "$next/collector.py"
chown -R root:root "$next"
chmod -R go-w "$next"

switch_to() {
  local target=$1
  local link=$release_root/.switch-reachability-$stamp
  ln -s "$target" "$link"
  mv -Tf "$link" "$current"
}
switch_to "$next"
if ! systemctl restart codeblack-status-center; then
  switch_to "$previous"
  systemctl restart codeblack-status-center || true
  echo 'Restart failed; previous release restored'
  exit 1
fi
healthy=0
for _ in {1..10}; do
  if curl --noproxy '*' -fsS --max-time 4 http://127.0.0.1:8795/api/health | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("ok") and d.get("version")=="1.0.2" and d.get("probes")==47 else 1)' 2>/dev/null; then
    healthy=1
    break
  fi
  sleep 1
done
if [[ $healthy -ne 1 ]]; then
  switch_to "$previous"
  systemctl restart codeblack-status-center || true
  echo 'Health check failed; previous release restored'
  exit 1
fi
echo "DEPLOYED=$next"
echo "ROLLBACK=$previous"
echo 'RESULT=PASS'
