#!/usr/bin/env bash
# Guarded Status Center release switch on Core. Preserves the previous release.
set -euo pipefail

archive=${1:?archive required}
expected_new_sha=${2:?server hash required}
expected_registry_sha=${3:?registry hash required}
case "$archive" in
  /tmp/status-center-backup-truth-*.tar) ;;
  *) echo 'ERROR = unexpected archive path'; exit 1 ;;
esac
[[ $(id -u) -eq 0 && $(hostname -s) == codeblack-core ]] || {
  echo 'ERROR = root on codeblack-core required'; exit 1
}
[[ $expected_new_sha =~ ^[0-9a-f]{64}$ && $expected_registry_sha =~ ^[0-9a-f]{64}$ ]] || { echo 'ERROR = invalid hash'; exit 1; }
[[ $(tar -tf "$archive" | sort) == $'deploy-backup-truth-remote.sh\nregistry.json\nserver.py' ]] || {
  echo 'ERROR = unexpected package members'; exit 1
}
package_sha=$(tar -xOf "$archive" server.py | sha256sum | awk '{print $1}')
[[ $package_sha == "$expected_new_sha" ]] || { echo 'ERROR = package hash mismatch'; exit 1; }
package_registry_sha=$(tar -xOf "$archive" registry.json | sha256sum | awk '{print $1}')
[[ $package_registry_sha == "$expected_registry_sha" ]] || { echo 'ERROR = registry package hash mismatch'; exit 1; }

release_root=/srv/codeblack/releases/status-center
current=$release_root/current
[[ -L $current ]] || { echo 'ERROR = current release symlink missing'; exit 1; }
previous=$(readlink -f -- "$current")
[[ $previous == "$release_root/"* && -f $previous/server.py && -f $previous/collector.py && -f $previous/registry.json ]] || {
  echo 'ERROR = unexpected current release'; exit 1
}
old_sha=$(sha256sum "$previous/server.py" | awk '{print $1}')
python3 - "$archive" "$previous/registry.json" <<'PY'
import json
import sys
import tarfile

def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate registry key")
        result[key] = value
    return result

with tarfile.open(sys.argv[1]) as package:
    expected = json.load(package.extractfile("registry.json"), object_pairs_hook=unique)
with open(sys.argv[2], encoding="utf-8") as source:
    actual = json.load(source, object_pairs_hook=unique)
edge = next(host for host in actual["hosts"] if host["id"] == "edge")
item = next(item for item in edge["checks"]["files"] if item["name"] == "backup-verification")
old = ["status", "generated_at", "backup_complete", "repositories_checked", "repositories_expected"]
new = ["status", "generated_at", "snapshot", "backup_complete", "inventory_present", "repositories_checked", "repositories_expected"]
if item["pick"] == old:
    item["pick"] = new
elif item["pick"] != new:
    raise SystemExit("ERROR = unexpected current registry backup fields")
if actual != expected:
    raise SystemExit("ERROR = registry has unrelated drift; refusing deployment")
PY
if [[ $old_sha == "$expected_new_sha" ]]; then
  if [[ $(sha256sum "$previous/registry.json" | awk '{print $1}') == "$expected_registry_sha" ]]; then
    echo 'STATUS CENTER BACKUP TRUTH = ALREADY DEPLOYED'
    echo 'RESULT = PASS'
    exit 0
  fi
  echo 'ERROR = server is already new but registry differs; inspect before retrying'
  exit 1
fi
# This is the exact previously deployed Edge probe fix build. Any intervening
# release is intentionally not overwritten by this narrow patch.
[[ $old_sha == aba08d28f89d48be8df594ee85128c4d76f51a4b32454149b29d7b52c754f025 ]] || {
  echo 'ERROR = current server differs from expected base; refusing overwrite'
  exit 1
}

stamp=$(date -u +%Y%m%dT%H%M%SZ)
next=$release_root/backup-truth-$stamp
[[ ! -e $next ]] || { echo 'ERROR = release path already exists'; exit 1; }
mkdir "$next"
cp -a "$previous/." "$next/"
tar -xf "$archive" -C "$next" server.py registry.json
[[ $(sha256sum "$next/server.py" | awk '{print $1}') == "$expected_new_sha" ]] || {
  echo 'ERROR = staged source hash mismatch; current release untouched'; exit 1
}
[[ $(sha256sum "$next/registry.json" | awk '{print $1}') == "$expected_registry_sha" ]] || {
  echo 'ERROR = staged registry hash mismatch; current release untouched'; exit 1
}
python3 -m py_compile "$next/server.py" "$next/collector.py"
chown -R root:root "$next"
chmod -R go-w "$next"

restore_previous() {
  rollback_link=$release_root/.rollback-backup-truth-$stamp
  ln -s "$previous" "$rollback_link"
  mv -Tf "$rollback_link" "$current"
  systemctl restart codeblack-status-center || true
}
candidate_link=$release_root/.current-backup-truth-$stamp
ln -s "$next" "$candidate_link"
mv -Tf "$candidate_link" "$current"
if ! systemctl restart codeblack-status-center; then
  restore_previous
  echo 'ERROR = service restart failed; previous release restored'
  exit 1
fi
healthy=0
for _ in {1..10}; do
  if response=$(curl --noproxy '*' -fsS --max-time 4 http://127.0.0.1:8795/api/health 2>/dev/null); then
    if printf '%s' "$response" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("ok") and d.get("version")=="1.0.1" and d.get("probes")==47 else 1)' 2>/dev/null; then
      healthy=1
      break
    fi
  fi
  sleep 1
done
if [[ $healthy -ne 1 ]]; then
  restore_previous
  echo 'ERROR = new build health check failed; previous release restored'
  exit 1
fi
echo 'STATUS CENTER BACKUP TRUTH = DEPLOYED'
echo "PREVIOUS RELEASE = $previous"
echo "NEW RELEASE = $next"
echo "SERVER SHA256 = $expected_new_sha"
echo 'PROBES = 47'
echo 'TAILSCALE/CLOUDFLARE CONFIG = UNCHANGED'
echo 'RESULT = PASS'
