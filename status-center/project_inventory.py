#!/usr/bin/env python3
"""Bounded project manifests, deployment receipts and systemd discovery.

Only administrative deployment tooling writes manifests/receipts. The collector
reads metadata and fixed systemd properties; a manifest cannot execute commands.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

CONFIG = Path(os.environ.get("CODEBLACK_PROJECT_CONFIG", "/srv/codeblack/config/project-landscape"))
STATE = Path(os.environ.get("CODEBLACK_PROJECT_STATE", "/srv/codeblack/data/status-center/project-inventory"))
ID = re.compile(r"[a-z0-9][a-z0-9-]{0,79}\Z")
UNIT = re.compile(r"[a-zA-Z0-9@_.:-]{1,160}\.(service|timer)\Z")
COMMIT = re.compile(r"[0-9a-f]{7,40}\Z")
CACHE = {"at": 0, "value": None}
LOCK = threading.Lock()


def stamp(at=None):
    return datetime.fromtimestamp(time.time() if at is None else at, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as handle:
            raw = handle.read(524289)
        if len(raw) > 524288:
            raise ValueError("metadata exceeds limit")
        return json.loads(raw)
    except (OSError, ValueError):
        return default


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".project-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, separators=(",", ":")); handle.write("\n")
            handle.flush(); os.fsync(handle.fileno())
        os.chmod(temp, 0o644)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def text(value, limit=240):
    if not isinstance(value, str) or not value.strip() or len(value) > limit or any(ord(c) < 32 for c in value):
        raise ValueError("invalid metadata text")
    return value.strip()


def validate_manifest(value):
    if not isinstance(value, dict) or value.get("schema") != "codeblack.project.v1" or not ID.fullmatch(value.get("id", "")):
        raise ValueError("invalid project manifest")
    result = {"schema": value["schema"], "id": value["id"], "name": text(value.get("name"), 100),
              "summary": text(value.get("summary")), "phase": text(value.get("phase", "DEVELOPMENT"), 80),
              "note": text(value.get("note", "Deployment health is evaluated separately from project milestones.")),
              "services": [], "links": []}
    services = value.get("services", [])
    links = value.get("links", [])
    if not isinstance(services, list) or len(services) > 80 or not isinstance(links, list) or len(links) > 12:
        raise ValueError("too many project entries")
    seen = set()
    for item in services:
        if not isinstance(item, dict) or not ID.fullmatch(item.get("id", "")) or not ID.fullmatch(item.get("host", "")):
            raise ValueError("invalid service identity")
        key = (item["host"], item["id"])
        if key in seen:
            raise ValueError("duplicate service")
        seen.add(key)
        service = {"id": item["id"], "host": item["host"], "name": text(item.get("name", item["id"]), 100)}
        if item.get("unit"):
            unit = item["unit"] if item["unit"].endswith((".service", ".timer")) else item["unit"] + ".service"
            if not UNIT.fullmatch(unit):
                raise ValueError("invalid systemd unit")
            service["unit"] = unit
        result["services"].append(service)
    for item in links:
        url = text(item.get("url"), 300)
        parsed = urlsplit(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("links must be public metadata without credentials or query strings")
        result["links"].append({"id": text(item.get("id"), 80), "name": text(item.get("name"), 100), "url": url, "access": "PRIVATE"})
    return result


def manifests(config=CONFIG):
    values, errors = [], []
    paths = sorted((Path(config) / "projects.d").glob("*.json"))
    for path in paths[:128]:
        try:
            values.append(validate_manifest(read_json(path)))
        except (ValueError, TypeError, AttributeError):
            errors.append({"kind": "INVALID_MANIFEST", "project": path.stem[:80]})
    if len(paths) > 128:
        errors.append({"kind": "MANIFEST_LIMIT", "project": "inventory"})
    return values, errors


def run(argv):
    result = subprocess.run(argv, capture_output=True, text=True, timeout=8)
    if result.returncode:
        raise RuntimeError("systemd inventory unavailable")
    return result.stdout


def release_of(properties):
    # Never emit raw command lines or environment values. Only release directory
    # labels under the fixed deployment root are retained.
    candidates = []
    for key in ("Environment", "ExecStart", "WorkingDirectory"):
        found = re.findall(r"/srv/codeblack/releases/[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+", properties.get(key, ""))
        candidates.extend(reversed(found) if key == "Environment" else found)
    for candidate in candidates:
        resolved = Path(candidate).resolve()
        if resolved.is_relative_to("/srv/codeblack/releases") and len(resolved.parts) >= 6:
            return resolved.parts[4] + "/" + resolved.parts[5]
    return None


def fingerprint(release):
    if not release:
        return None
    root = Path("/srv/codeblack/releases") / release
    # Bounded metadata fingerprint detects in-place updates without reading
    # source, secrets or logs. Include the web entry when the release serves dist.
    paths = sorted(root.glob("*.py"))[:20] + sorted(root.glob("*.cjs"))[:10] + sorted(root.glob("*.js"))[:10]
    paths += [root / "dist" / "index.html", root / "index.html"]
    values = []
    for path in paths:
        try:
            stat = path.stat()
            if path.is_file():
                values.append((str(path.relative_to(root)), stat.st_size, stat.st_mtime_ns))
        except OSError:
            pass
    return hashlib.sha256(json.dumps(values).encode()).hexdigest() if values else None


def discover_units(expected=(), user=False):
    ctl = ["systemctl", "--user"] if user else ["systemctl"]
    listing = run(ctl + ["list-unit-files", "--no-legend", "--no-pager", "codeblack*.service", "codeblack*.timer"])
    names = {line.split()[0] for line in listing.splitlines() if line.split() and UNIT.fullmatch(line.split()[0])}
    names.update(unit for unit in expected if UNIT.fullmatch(unit))
    # Include loaded transient units as well as installed unit files.
    loaded = run(ctl + ["list-units", "--all", "--plain", "--no-legend", "--no-pager", "codeblack*.service", "codeblack*.timer"])
    names.update(line.split()[0] for line in loaded.splitlines() if line.split() and UNIT.fullmatch(line.split()[0]))
    if len(names) > 256:
        raise RuntimeError("systemd inventory exceeds 256-unit limit")
    if not names:
        return {}
    fields = ["Id", "LoadState", "ActiveState", "SubState", "Result", "Type", "ExecMainStartTimestamp", "WorkingDirectory", "ExecStart", "Environment", "Triggers"]
    raw = run(ctl + ["show", "--no-pager", "--property=" + ",".join(fields), *sorted(names)])
    result = {}
    for block in raw.strip().split("\n\n"):
        props = dict(line.split("=", 1) for line in block.splitlines() if "=" in line)
        name = props.get("Id")
        if name not in names:
            continue
        active = props.get("ActiveState", "unknown")
        state = "UNKNOWN" if props.get("LoadState") != "loaded" else "DEGRADED" if active == "failed" else "HEALTHY" if active == "active" else "BUSY" if active in ("activating", "reloading") else "IDLE" if props.get("Type") == "oneshot" and props.get("Result") == "success" else "OFFLINE"
        release = release_of(props)
        result[name] = {"unit": name, "state": state, "scope": "user" if user else "system", "installed": props.get("LoadState") == "loaded", "active": active, "sub": props.get("SubState"),
                        "result": props.get("Result"), "runtime_started_at": props.get("ExecMainStartTimestamp") or None,
                        "release": release, "artifact_fingerprint": fingerprint(release), "triggers": [x for x in props.get("Triggers", "").split() if UNIT.fullmatch(x)],
                        "evidence": "systemd process state; functional health requires a registered probe"}
    return result


def observe_changes(units, state_dir=STATE):
    path = Path(state_dir) / "observations.json"
    previous = read_json(path, {})
    if not isinstance(previous, dict):
        previous = {}
    before = previous.get("units", {})
    events = previous.get("events", [])[-99:]
    current = {name: value.get("release") for name, value in units.items()}
    for name, release in current.items():
        if release and name in before and before[name] != release:
            events.append({"unit": name, "release": release, "observed_at": stamp(), "kind": "RELEASE_CHANGE_OBSERVED"})
    if current != before:
        atomic_json(path, {"units": current, "events": events[-100:]})
    return events[-100:]


def collect(config=CONFIG, state_dir=STATE, expected=(), host="core"):
    if os.name == "nt":
        return {"generated_at": stamp(), "available": False, "error": "systemd discovery is not supported on this host", "projects": [], "units": {}}
    with LOCK:
        if CACHE["value"] is not None and time.time() - CACHE["at"] < 60:
            return CACHE["value"]
        projects, errors = manifests(config)
        all_expected = list(expected) + [s["unit"] for p in projects for s in p["services"] if s.get("unit") and s["host"] == host]
        try:
            units = discover_units(all_expected)
            try:
                for name, value in discover_units(user=True).items():
                    if not units.get(name, {}).get("installed"):
                        units[name] = value
            except (OSError, RuntimeError, subprocess.SubprocessError):
                pass  # A system collector need not have a user-session bus.
            try:
                events = observe_changes(units, state_dir)
            except OSError:
                events = []; errors.append({"kind": "OBSERVATION_WRITE_FAILED", "project": "inventory"})
            receipts = read_json(Path(config) / "deployments.json", {})
            if not isinstance(receipts, dict):
                receipts = {}
            value = {"generated_at": stamp(), "available": True, "projects": projects, "units": units,
                     "deployments": {unit: {k: v for k, v in value.items() if k in ("latest_attempt", "last_success")} for unit, value in receipts.items() if isinstance(value, dict)}, "events": events, "errors": errors}
            try:
                atomic_json(Path(state_dir) / "last-inventory.json", value)
            except OSError:
                value["errors"].append({"kind": "INVENTORY_WRITE_FAILED", "project": "inventory"})
        except (OSError, RuntimeError, subprocess.SubprocessError):
            previous = CACHE["value"] or read_json(Path(state_dir) / "last-inventory.json", {}) or {}
            value = {**previous, "available": False, "projects": projects or previous.get("projects", []),
                     "errors": errors + [{"kind": "DISCOVERY_UNAVAILABLE", "project": "inventory"}]}
        CACHE.update(at=time.time(), value=value)
        return value


def record(payload, config=CONFIG):
    """Root-owned metadata only; no service execution or network access."""
    manifest = validate_manifest(payload.get("manifest"))
    host = payload.get("host", "")
    unit = payload.get("unit", "")
    release = payload.get("release", "")
    commit = payload.get("commit")
    status = payload.get("result")
    attempt = payload.get("attempt", "")
    if not ID.fullmatch(host) or not UNIT.fullmatch(unit) or not re.fullmatch(r"[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+", release):
        raise ValueError("invalid deployment target")
    if not any(s.get("host") == host and s.get("unit") == unit for s in manifest["services"]):
        raise ValueError("deployment target must belong to manifest")
    if commit is not None and not COMMIT.fullmatch(commit):
        raise ValueError("invalid Git commit")
    if status not in ("started", "succeeded", "failed") or not re.fullmatch(r"[a-zA-Z0-9_.-]{1,100}", attempt):
        raise ValueError("invalid deployment result or attempt")
    # Serialize concurrent deploys so unrelated receipts cannot overwrite one another.
    import fcntl
    Path(config).mkdir(parents=True, exist_ok=True)
    with open(Path(config) / ".deploy.lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        path = Path(config) / "deployments.json"
        records = read_json(path, {})
        if not isinstance(records, dict):
            raise ValueError("deployment store needs repair")
        previous = records.get(unit, {})
        latest = previous.get("latest_attempt", {})
        if status != "started" and latest.get("attempt") not in (None, attempt):
            raise ValueError("deployment superseded by a newer attempt")
        receipt = {"project_id": manifest["id"], "unit": unit, "host": host, "release": release,
                   "commit": commit, "result": status, "attempt": attempt, "reported_at": stamp(),
                   "dirty": bool(payload.get("dirty"))}
        previous["latest_attempt"] = receipt
        if status == "succeeded":
            observed = discover_units([unit]).get(unit, {})
            if observed.get("release") == release:
                receipt["artifact_fingerprint"] = observed.get("artifact_fingerprint")
            previous["last_success"] = receipt
        previous["history"] = (previous.get("history", []) + [receipt])[-20:]
        records[unit] = previous
        if len(records) > 256:
            raise ValueError("deployment store exceeds limit")
        atomic_json(Path(config) / "projects.d" / (manifest["id"] + ".json"), manifest)
        atomic_json(path, records)
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("record", "collect", "register"))
    parser.add_argument("--config", default=str(CONFIG))
    args = parser.parse_args()
    if args.command == "collect":
        print(json.dumps(collect(Path(args.config))))
    else:
        import sys
        payload = json.loads(sys.stdin.read(65537))
        if args.command == "register":
            value = validate_manifest(payload)
            atomic_json(Path(args.config) / "projects.d" / (value["id"] + ".json"), value)
            print(json.dumps({"registered": value["id"]}))
        else:
            print(json.dumps(record(payload, Path(args.config))))
