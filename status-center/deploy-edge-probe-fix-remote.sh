#!/usr/bin/env bash
# Run on CORE only, via Deploy-EdgeProbeFix.ps1. Does not change Tailscale or Cloudflare.
set -euo pipefail

archive=${1:?archive required}
case "$archive" in
  /tmp/status-center-edge-probe-fix-*.tar) ;;
  *) echo 'ERROR = unexpected archive path'; exit 1 ;;
esac
if [[ $(id -u) -ne 0 ]]; then
  echo 'ERROR = root required for release switch and service restart'
  exit 1
fi

release_root=/srv/codeblack/releases/status-center
current=$release_root/current
[[ -L $current ]] || { echo 'ERROR = current release symlink missing'; exit 1; }
previous=$(readlink -f -- "$current")
[[ $previous == "$release_root/"* ]] || { echo 'ERROR = current release outside expected root'; exit 1; }
[[ -f $previous/server.py && -f $previous/registry.json && -f $previous/collector.py ]] || {
  echo 'ERROR = current release incomplete'; exit 1;
}

# The registry is configuration, so preserve CORE's formatting while requiring
# its parsed contents to match the locally tested package exactly. Reject
# duplicate JSON keys so parsing cannot conceal a conflicting entry.
registry_matches_package() {
  python3 - "$archive" "$1" <<'PY'
import json
import sys
import tarfile

def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate registry key")
        result[key] = value
    return result

def same_value(left, right):
    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(same_value(left[key], right[key]) for key in left)
    if isinstance(left, list):
        return len(left) == len(right) and all(same_value(a, b) for a, b in zip(left, right))
    return left == right

try:
    with tarfile.open(sys.argv[1]) as package:
        expected = json.load(package.extractfile("registry.json"), object_pairs_hook=unique_pairs)
    with open(sys.argv[2], encoding="utf-8") as source:
        actual = json.load(source, object_pairs_hook=unique_pairs)
except (OSError, ValueError, KeyError, TypeError, tarfile.TarError):
    sys.exit(1)
sys.exit(0 if same_value(actual, expected) else 1)
PY
}

stamp=$(date -u +%Y%m%dT%H%M%SZ)
next=$release_root/edge-probe-fix-$stamp
[[ ! -e $next ]] || { echo 'ERROR = release already exists'; exit 1; }

# Refuse to overwrite an unfamiliar deployment. An identical deployment is already complete.
if ! grep -q '"id": "edge_tcp"' "$previous/registry.json"; then
  if cmp -s <(tar -xOf "$archive" server.py) "$previous/server.py" &&
     registry_matches_package "$previous/registry.json"; then
    echo 'STATUS CENTER EDGE PROBE FIX = ALREADY DEPLOYED'
    echo 'RESULT = PASS'
    exit 0
  fi
  echo 'ERROR = current release has no edge_tcp probe but differs from this package'
  exit 1
fi

mkdir "$next"
cp -a "$previous/." "$next/"
# Apply only the expected source edits to the copied release. Any remote drift
# makes the resulting files differ from the locally tested package and blocks the switch.
python3 - "$next/server.py" "$next/registry.json" <<'PY'
from pathlib import Path
import sys

server = Path(sys.argv[1])
registry = Path(sys.argv[2])

def replace_once(path, old, new):
    text = path.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise SystemExit(f"ERROR = expected source block missing or duplicated: {path.name}")
    path.write_text(text.replace(old, new), encoding="utf-8")

replace_once(registry, '''    {
      "id": "edge_tcp",
      "kind": "tcp",
      "host": "100.88.198.67",
      "port": 443,
      "interval": "host"
    },
''', '')
replace_once(server, '''    tcp_ok = {"edge": "edge_tcp"}.get(h["id"])
    tcp_alive = bool(tcp_ok and PROBES[tcp_ok].ok and not PROBES[tcp_ok].stale)
    online = cfresh or any(reach) or tcp_alive or bool(peer and peer["online"] and h["collector"]["mode"] == "none")
''', '''    edge_peer_alive = h["id"] == "edge" and pfresh_ok("tailscale") is True and bool(peer and peer["online"])
    online = cfresh or any(reach) or edge_peer_alive or bool(peer and peer["online"] and h["collector"]["mode"] == "none")
''')
replace_once(server, '''                pr = {"edge": "edge_tcp", "phaenon3": "phaenon3_tcp", "hytetower": "hytetower_rdp"}.get(h["id"])
''', '''                pr = {"phaenon3": "phaenon3_tcp", "hytetower": "hytetower_rdp"}.get(h["id"])
''')
replace_once(server, '''    pair("core", "edge", "edge_tcp"); pair("core", "phaenon3", "phaenon3_tcp"); pair("core", "hytetower", "hytetower_rdp")
''', '''    edge_peer = tail_peer(HOSTS["edge"]["tailscale_peer"])
    edge_observed = pfresh_ok("tailscale") is True and edge_peer is not None
    pairs.append({"from": "core", "to": "edge", "state": ("HEALTHY" if edge_peer["online"] else "OFFLINE") if edge_observed else "UNKNOWN",
                  "latency_ms": None, "path": edge_peer.get("path", "unknown") if edge_observed else "unknown"})
    pair("core", "phaenon3", "phaenon3_tcp"); pair("core", "hytetower", "hytetower_rdp")
''')
PY
if ! cmp -s <(tar -xOf "$archive" server.py) "$next/server.py"; then
  echo 'ERROR = remote server.py differs from the locally tested build after the narrow patch; current release untouched'
  echo "STAGED RELEASE = $next"
  exit 1
fi
if ! registry_matches_package "$next/registry.json"; then
  echo 'ERROR = remote registry.json contents differ from the locally tested build after the narrow patch; current release untouched'
  echo "STAGED RELEASE = $next"
  exit 1
fi

expected=$(python3 - "$next/registry.json" <<'PY'
import json, sys
r = json.load(open(sys.argv[1], encoding="utf-8"))
ids = {p["id"] for p in r["probes"]}
assert "edge_tcp" not in ids
assert "edge_collector" in ids and "tailscale" in ids
assert any(x["id"] == "edge-dashboard" and x.get("verify") for x in r["links"])
print(len(r["probes"]) + sum(bool(x.get("verify")) for x in r["links"]))
PY
)
[[ $expected == 47 ]] || { echo 'ERROR = unexpected probe count'; exit 1; }
if grep -q 'edge_tcp' "$next/server.py"; then
  echo 'ERROR = server still references edge_tcp'
  exit 1
fi
python3 -m py_compile "$next/server.py" "$next/collector.py"
chown -R root:root "$next"
chmod -R go-w "$next"

restore_previous() {
  rollback_link=$release_root/.rollback-edge-probe-$stamp
  ln -s "$previous" "$rollback_link"
  mv -Tf "$rollback_link" "$current"
  systemctl restart codeblack-status-center || true
}

candidate_link=$release_root/.current-edge-probe-$stamp
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
    if actual=$(printf '%s' "$response" | python3 -c 'import json,sys; print(json.load(sys.stdin)["probes"])' 2>/dev/null); then
      if [[ $actual == "$expected" ]]; then healthy=1; break; fi
    fi
  fi
  sleep 1
done
if [[ $healthy -ne 1 ]]; then
  restore_previous
  echo 'ERROR = health/probe-count verification failed; previous release restored'
  exit 1
fi

echo 'STATUS CENTER EDGE PROBE FIX = DEPLOYED'
echo "PREVIOUS RELEASE = $previous"
echo "NEW RELEASE = $next"
echo "PROBES = $actual"
echo 'EDGE TCP 443 PROBE = REMOVED'
echo 'TAILSCALE/CLOUDFLARE CONFIG = UNCHANGED'
echo 'RESULT = PASS'
