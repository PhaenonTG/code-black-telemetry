#!/usr/bin/env bash
# Guarded Edge repair: one Pi-hole restart, one Core backup retry, one verification.
# No Pi-hole configuration, firewall, Tailscale, or notification settings are changed.
set -euo pipefail

expected_script_sha=${1:?script hash required}
[[ $expected_script_sha =~ ^[0-9a-f]{64}$ ]] || { echo 'ERROR = invalid script hash'; exit 1; }
[[ $(sha256sum "$0" | awk '{print $1}') == "$expected_script_sha" ]] || {
  echo 'ERROR = transferred script hash mismatch'; exit 1
}
[[ $(id -u) -eq 0 ]] || { echo 'ERROR = run as root via sudo'; exit 1; }
[[ $(hostname -s) == codeblack-edge ]] || { echo 'ERROR = not codeblack-edge'; exit 1; }
command -v python3 >/dev/null || { echo 'ERROR = python3 unavailable'; exit 1; }
systemctl is-active --quiet tailscaled || { echo 'ERROR = tailscaled not active'; exit 1; }
ip link show dev tailscale0 >/dev/null 2>&1 || {
  echo 'ERROR = tailscale0 is absent; refusing Pi-hole restart or backup retry'
  exit 1
}
collector_dir=/srv/codeblack/services/status-collector
collector_registry=$collector_dir/registry.json
collector_keepalive=$collector_dir/keepalive.sh
collector_pid_file=$collector_dir/collector.pid
[[ -f $collector_registry && -f $collector_keepalive && -f $collector_pid_file ]] || {
  echo 'ERROR = Edge collector paths missing; refusing partial repair'
  exit 1
}
collector_pid=$(cat "$collector_pid_file")
[[ $collector_pid =~ ^[0-9]+$ && -r /proc/$collector_pid/cmdline ]] || {
  echo 'ERROR = Edge collector PID is not verifiable; refusing partial repair'
  exit 1
}
collector_cmd=$(tr '\0' ' ' < "/proc/$collector_pid/cmdline")
[[ $collector_cmd == *'collector.py --host edge'* ]] || {
  echo 'ERROR = collector PID belongs to an unexpected process; refusing partial repair'
  exit 1
}
python3 - "$collector_registry" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as source:
    registry = json.load(source)
edge = next(host for host in registry["hosts"] if host["id"] == "edge")
item = next(item for item in edge["checks"]["files"] if item["name"] == "backup-verification")
allowed = (
    ["status", "generated_at", "backup_complete", "repositories_checked", "repositories_expected"],
    ["status", "generated_at", "snapshot", "backup_complete", "inventory_present", "repositories_checked", "repositories_expected"],
)
if item["pick"] not in allowed:
    raise SystemExit("ERROR = unexpected Edge collector backup field list")
PY
backup_root=/srv/codeblack/backups/core/snapshots
verification=/srv/codeblack/data/status/backup-verification.json
[[ -d $backup_root && -f $verification ]] || {
  echo 'ERROR = expected backup paths missing; refusing partial repair'
  exit 1
}

dns_responds() {
  python3 - "$1" <<'PY'
import socket
import struct
import sys

server = sys.argv[1]
name = b"\x07example\x03com\x00"
request_id = 0x53A1
packet = struct.pack("!HHHHHH", request_id, 0x0100, 1, 0, 0, 0) + name + struct.pack("!HH", 1, 1)
try:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.settimeout(3)
        sock.connect((server, 53))
        sock.send(packet)
        reply = sock.recv(2048)
    ident, flags, _questions, answers, _authority, _extra = struct.unpack("!HHHHHH", reply[:12])
    if ident != request_id or not (flags & 0x8000) or (flags & 0x000F) or answers < 1:
        raise ValueError("DNS response was not a successful answer")
except (OSError, ValueError, struct.error):
    sys.exit(1)
PY
}

dns_all_respond() {
  dns_responds 127.0.0.1 && dns_responds 192.168.0.12 && dns_responds 100.88.198.67
}

if dns_all_respond; then
  echo 'PI-HOLE DNS = ALREADY HEALTHY (restart skipped)'
else
  systemctl is-active --quiet pihole-FTL || { echo 'ERROR = pihole-FTL not active'; exit 1; }
  echo 'PI-HOLE DNS = FAILED; restarting pihole-FTL once'
  systemctl restart pihole-FTL
  sleep 3
  systemctl is-active --quiet pihole-FTL || { echo 'ERROR = pihole-FTL restart failed'; exit 1; }
  dns_all_respond || { echo 'ERROR = DNS still fails after one restart; no backup attempted'; exit 1; }
  echo 'PI-HOLE DNS = PASS (loopback, LAN, Tailscale IPv4)'
fi

# FTL started while tailscale0 was not yet known to dnsmasq on this boot.
# Wait for that exact interface on future boots; do not change Pi-hole's DNS
# configuration or globally delay unrelated services.
dropin_dir=/etc/systemd/system/pihole-FTL.service.d
dropin=$dropin_dir/10-codeblack-wait-tailscale0.conf
ip_cmd=$(command -v ip)
dropin_text="[Unit]
Wants=tailscaled.service
After=tailscaled.service

[Service]
ExecStartPre=/usr/bin/timeout 45 /bin/sh -c 'until $ip_cmd link show dev tailscale0 >/dev/null 2>&1; do sleep 1; done'"
if [[ -e $dropin || -L $dropin ]]; then
  [[ -f $dropin && ! -L $dropin && $(cat "$dropin") == "$dropin_text" ]] || {
    echo 'ERROR = existing Pi-hole drop-in differs; refusing to overwrite it'
    exit 1
  }
  echo 'PI-HOLE BOOT GUARD = ALREADY INSTALLED'
else
  install -d -m 0755 "$dropin_dir"
  printf '%s\n' "$dropin_text" > "$dropin"
  chmod 0644 "$dropin"
  if ! systemctl daemon-reload; then
    rm -- "$dropin"
    systemctl daemon-reload || true
    echo 'ERROR = Pi-hole boot guard could not load; exact new drop-in removed'
    exit 1
  fi
  echo 'PI-HOLE BOOT GUARD = INSTALLED (next boot; no reboot performed)'
fi

if [[ $(systemctl show codeblack-core-backup.service -p ActiveState --value) == activating ||
      $(systemctl show codeblack-backup-verify.service -p ActiveState --value) == activating ]]; then
  echo 'ERROR = backup or verification already running; refusing a parallel run'
  exit 1
fi
latest_directory() {
  find "$backup_root" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' |
    grep -E '^[0-9]{8}T[0-9]{6}Z$' | sort | tail -n 1
}
verify_latest() {
  python3 - "$verification" "$backup_root/$1" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    result = json.load(source)
expected = result.get("repositories_expected")
if not (result.get("snapshot") == sys.argv[2]
        and result.get("status") == "healthy"
        and result.get("backup_complete") is True
        and result.get("inventory_present") is True
        and isinstance(expected, int) and expected > 0
        and result.get("repositories_checked") == expected
        and not result.get("issues")):
    raise SystemExit("verification did not prove the expected snapshot")
PY
}
before=$(latest_directory || true)
if [[ -n $before ]] && verify_latest "$before" >/dev/null 2>&1; then
  echo "BACKUP = ALREADY VERIFIED ($before); retry skipped"
  after=$before
else
  timeout 6 bash -c 'exec 3<>/dev/tcp/100.96.77.89/22' 2>/dev/null || {
    echo 'ERROR = Core SSH port unreachable; no backup attempted'
    exit 1
  }
  available_kib=$(df -Pk "$backup_root" | awk 'NR==2 {print $4}')
  [[ $available_kib =~ ^[0-9]+$ && $available_kib -gt 10485760 ]] || {
    echo 'ERROR = less than 10 GiB free for backup; no backup attempted'
    exit 1
  }
  echo 'CORE SSH PORT = REACHABLE; starting one backup pull'
  systemctl reset-failed codeblack-core-backup.service
  systemctl start codeblack-core-backup.service || { echo 'ERROR = backup pull failed; alert remains active'; exit 1; }
  [[ $(systemctl show codeblack-core-backup.service -p Result --value) == success ]] || {
    echo 'ERROR = backup unit did not report success'
    exit 1
  }
  after=$(latest_directory || true)
  [[ -n $after && $after != "$before" ]] || {
    echo 'ERROR = backup did not create a new dated snapshot; alert remains active'
    exit 1
  }
  systemctl start codeblack-backup-verify.service || {
    echo 'ERROR = verification service failed; alert remains active'
    exit 1
  }
  verify_latest "$after" || { echo 'ERROR = new snapshot verification did not match; alert remains active'; exit 1; }
fi
echo "VERIFIED SNAPSHOT = $after"
echo 'BACKUP = PASS'

# The Edge collector previously omitted the verifier's snapshot identity.
# Add only those two approved read-only fields, then restart that collector so
# Status Center can correlate the exact snapshot rather than a directory mtime.
stamp=$(date -u +%Y%m%dT%H%M%SZ)
collector_backup=$collector_dir/registry.pre-backup-truth-$stamp.json
cp -a "$collector_registry" "$collector_backup"
if ! python3 - "$collector_registry" <<'PY'
import json
import os
import stat
import sys
import tempfile

path = sys.argv[1]
with open(path, encoding="utf-8") as source:
    registry = json.load(source)
edge = next(host for host in registry["hosts"] if host["id"] == "edge")
item = next(item for item in edge["checks"]["files"] if item["name"] == "backup-verification")
old = ["status", "generated_at", "backup_complete", "repositories_checked", "repositories_expected"]
new = ["status", "generated_at", "snapshot", "backup_complete", "inventory_present", "repositories_checked", "repositories_expected"]
if item["pick"] == new:
    print("EDGE COLLECTOR REGISTRY = ALREADY UPDATED")
    sys.exit(0)
if item["pick"] != old:
    raise SystemExit("ERROR = unexpected Edge collector backup field list")
item["pick"] = new
original = os.stat(path)
fd, temporary = tempfile.mkstemp(prefix=".registry-backup-truth-", dir=os.path.dirname(path))
try:
    with os.fdopen(fd, "w", encoding="utf-8") as output:
        json.dump(registry, output, indent=2)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    os.chown(temporary, original.st_uid, original.st_gid)
    os.chmod(temporary, stat.S_IMODE(original.st_mode))
    os.replace(temporary, path)
except BaseException:
    if os.path.exists(temporary):
        os.unlink(temporary)
    raise
print("EDGE COLLECTOR REGISTRY = UPDATED")
PY
then
  cp -a "$collector_backup" "$collector_registry"
  echo 'ERROR = collector registry patch failed; original restored'
  exit 1
fi

restart_collector() {
  local running_pid running_cmd
  running_pid=$(cat "$collector_pid_file")
  if [[ $running_pid =~ ^[0-9]+$ && -r /proc/$running_pid/cmdline ]]; then
    running_cmd=$(tr '\0' ' ' < "/proc/$running_pid/cmdline")
    [[ $running_cmd == *'collector.py --host edge'* ]] || return 1
    kill -TERM "$running_pid"
    for _ in {1..20}; do
      [[ ! -d /proc/$running_pid ]] && break
      sleep 0.2
    done
    [[ ! -d /proc/$running_pid ]] || return 1
  fi
  runuser -u codeblack -- /bin/sh "$collector_keepalive"
}
if ! restart_collector; then
  cp -a "$collector_backup" "$collector_registry"
  echo 'ERROR = collector restart failed; registry restored; backup is verified'
  exit 1
fi
collector_ok=0
for _ in {1..15}; do
  if metrics=$(curl --noproxy '*' -fsS --max-time 3 http://100.88.198.67:9110/v1/metrics 2>/dev/null); then
    if printf '%s' "$metrics" | python3 -c 'import json,sys; r=json.load(sys.stdin)["files"]["backup-verification"]["json"]; sys.exit(0 if r.get("snapshot")==sys.argv[1] and r.get("inventory_present") is True else 1)' "$backup_root/$after"
    then collector_ok=1; break; fi
  fi
  sleep 1
done
if [[ $collector_ok -ne 1 ]]; then
  cp -a "$collector_backup" "$collector_registry"
  restart_collector || true
  echo 'ERROR = collector did not expose verified snapshot; registry restored'
  exit 1
fi
echo 'EDGE COLLECTOR = VERIFIED SNAPSHOT VISIBLE'
echo 'ALERT = awaiting the next normal evaluation; notification settings unchanged'
echo 'RESULT = PASS'
