#!/usr/bin/env python3
"""Forward all monitored Edge and Status Center alert transitions to ntfy.

The existing Edge evaluator owns infrastructure incidents. Status Center owns
service-level attention. This bridge only delivers transitions; it does not
create a second monitoring authority or re-page existing conditions on install.
"""

import datetime as dt
import hashlib
import json
import os
import re
import time
import urllib.request
import urllib.parse
from pathlib import Path

EVENTS = Path(os.environ.get("CODEBLACK_ALERT_EVENTS", "/srv/codeblack/data/alerts/events.jsonl"))
STATE = Path(os.environ.get("CODEBLACK_NTFY_BRIDGE_STATE", "/srv/codeblack/data/notifications/ntfy-bridge-state.json"))
HEALTH = Path(os.environ.get("CODEBLACK_NTFY_BRIDGE_HEALTH", "/srv/codeblack/data/status/ntfy-bridge-status.json"))
TOKEN = Path(os.environ.get("CODEBLACK_NTFY_OPS_TOKEN", "/srv/codeblack/private/ntfy/ops-publisher-token.txt"))
STATUS_URL = os.environ.get("CODEBLACK_STATUS_URL", "https://codeblack-core.tail1d0673.ts.net/status/api/status")
NTFY_URL = os.environ.get("CODEBLACK_NTFY_URL", "https://codeblack-core.tail1d0673.ts.net:8443/ops-monitoring")
DASHBOARD_URL = "https://codeblack-core.tail1d0673.ts.net/status/"
ACTION_URL = "https://codeblack-core.tail1d0673.ts.net/alert-actions"
ACTION_STATE_URL = ACTION_URL + "/api/state"
ACTION_CACHE = {"at": 0, "value": {}}
NOTIFICATION_DIR = Path(os.environ.get("CODEBLACK_NOTIFICATION_DIR", "/srv/codeblack/data/notifications"))
INCIDENT_TYPES = {"incident_start", "incident_update", "recovery"}
STATE_WORDS = re.compile(r"\b(OFFLINE|DEGRADED|UNKNOWN|STALE|AGING|CRITICAL|ERROR|UNAVAILABLE|VERIFYING)\b", re.I)
BAD_POLLS = 3
GOOD_POLLS = 2


def utcnow():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def load(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def action_headers(alert_id):
    incident = ACTION_URL + "/incident?id=" + urllib.parse.quote(alert_id, safe="")
    return {"Click": incident, "Actions": f"view, Open Status, {DASHBOARD_URL}; view, View Incident, {incident}"}


def snoozed(alert_id):
    try:
        if time.time() - ACTION_CACHE["at"] > 10:
            ACTION_CACHE["at"] = time.time()
            with urllib.request.urlopen(ACTION_STATE_URL, timeout=2) as response:
                ACTION_CACHE["value"] = json.load(response)
        state = ACTION_CACHE["value"].get(alert_id, {})
        until = state.get("snoozed_until")
        return bool(until and dt.datetime.fromisoformat(until.replace("Z", "+00:00")) > dt.datetime.now(dt.timezone.utc))
    except (OSError, ValueError, TypeError):
        return False  # Alert delivery fails open if the action console is unavailable.


def publish(title, body, priority="default", tags="warning", alert_id="edge:incident"):
    token = TOKEN.read_text(encoding="utf-8").strip()
    if not token:
        raise RuntimeError("ops publisher token is empty")
    req = urllib.request.Request(
        NTFY_URL,
        data=body.encode("utf-8"),
        headers={
            "Authorization": "Bearer " + token,
            "Title": title,
            "Priority": priority,
            "Tags": tags,
            **action_headers(alert_id),
            "User-Agent": "CodeBlack-Edge-OpsBridge/1.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=8) as response:
        if response.status != 200:
            raise RuntimeError(f"ntfy HTTP {response.status}")


def issue_keys(event):
    keys = []
    for issue in event.get("issues", []):
        name, _, value = str(issue).partition(":")
        # A changing backup age or disk percentage is not a new incident;
        # a different failed node or service is.
        keys.append(name if value.replace(".", "", 1).isdigit() else str(issue))
    return sorted(keys)


def send_edge_events(state):
    if not EVENTS.exists():
        return 0
    size = EVENTS.stat().st_size
    if "event_offset" not in state:
        state["event_offset"] = size  # baseline; do not replay historical incidents
        return 0
    offset = int(state["event_offset"])
    if offset > size:
        offset = 0  # log rotated
    sent = 0
    with EVENTS.open("r", encoding="utf-8") as stream:
        stream.seek(offset)
        while True:
            line = stream.readline()
            if not line:
                break
            next_offset = stream.tell()
            try:
                event = json.loads(line)
            except ValueError:
                state["event_offset"] = next_offset
                continue
            kind = event.get("type")
            if kind not in INCIDENT_TYPES:
                state["event_offset"] = next_offset
                continue
            keys = issue_keys(event)
            if kind == "incident_update" and keys == state.get("last_edge_issue_keys"):
                state["event_offset"] = next_offset
                continue
            title = {"incident_start": "Code Black incident", "incident_update": "Code Black incident changed", "recovery": "Code Black recovered"}[kind]
            body = "\n".join(str(x) for x in event.get("issues", [])[:12]) or "Infrastructure recovered."
            if kind == "incident_start":
                started = str(event.get("time") or next_offset)
                state["edge_incident_id"] = "edge:incident:" + hashlib.sha256(started.encode()).hexdigest()[:16]
            alert_id = state.get("edge_incident_id") or "edge:incident"
            if not snoozed(alert_id):
                publish(title, body, "high" if kind != "recovery" else "default", "rotating_light" if kind != "recovery" else "white_check_mark", alert_id)
                sent += 1
            state["event_offset"] = next_offset
            state["last_edge_issue_keys"] = keys if kind != "recovery" else []
            if kind == "recovery":
                state.pop("edge_incident_id", None)
            save(STATE, state)  # restart-safe delivery cursor
    return sent


def send_other_edge_events(state):
    """Deliver non-incident events from the shared Discord outbox as well."""
    files = {}
    for folder in ("outbox", "sent", "failed"):
        for path in (NOTIFICATION_DIR / folder).glob("*.json"):
            files.setdefault(path.name, path)
    seen = set(state.get("other_edge_seen", []))
    if not state.get("other_edge_baselined"):
        state["other_edge_seen"] = sorted(files)
        state["other_edge_baselined"] = True
        return 0
    sent = 0
    for name, path in sorted(files.items()):
        if name in seen:
            continue
        if not path.exists():
            continue  # Discord may have moved an outbox file during this scan.
        event = load(path, {})
        kind = str(event.get("type", "unknown"))
        if kind not in INCIDENT_TYPES:
            stream = event.get("stream") or {}
            if kind == "stream_live" and isinstance(stream, dict):
                body = f"{stream.get('owner', 'Code Black')} live on {stream.get('provider', 'stream provider')}"
                if str(stream.get("url", "")).startswith("https://"):
                    body += f"\n{stream['url']}"
                title = "Code Black stream live"
            elif kind == "test":
                title, body = "Code Black notification test", "Test event from Edge."
            else:
                title = f"Code Black event: {kind[:80]}"
                body = "\n".join(str(issue) for issue in event.get("issues", [])[:12]) or "See Status Center for details."
            alert_id = "edge:event:" + hashlib.sha256(name.encode()).hexdigest()[:16]
            if not snoozed(alert_id):
                publish(title, body, "default", "information_source", alert_id)
                sent += 1
        seen.add(name)
        state["other_edge_seen"] = sorted(seen)
        save(STATE, state)
    return sent


def get_attention():
    with urllib.request.urlopen(STATUS_URL, timeout=8) as response:
        payload = json.load(response)
    generated = payload.get("generated_at")
    if generated:
        age = time.time() - dt.datetime.fromisoformat(generated.replace("Z", "+00:00")).timestamp()
        if age > 180 or age < -60:
            raise RuntimeError(f"Status Center snapshot stale ({age:.0f}s)")
    return {
        item["id"]: item for item in payload.get("attention", [])
        if item.get("severity") in {"INFO", "WARNING", "ERROR", "CRITICAL"}
        and "vram_above_90_percent" not in item.get("id", "").lower()
    }


def attention_marker(item):
    match = STATE_WORDS.search(item.get("title", ""))
    return match.group(1).upper() if match else ""


def attention_priority(item):
    return "urgent" if item.get("severity") in {"CRITICAL", "ERROR"} else (
        "high" if item.get("severity") == "WARNING" else "default"
    )


def send_status_transitions(state):
    current = get_attention()
    tracked = state.setdefault("attention", {})
    if not state.get("attention_baselined") or state.get("coverage_version", 0) < 2:
        for key, item in current.items():
            tracked[key] = {"active": True, "bad": BAD_POLLS, "good": 0, "title": item.get("title", key),
                            "severity": item.get("severity"), "marker": attention_marker(item),
                            "notified": attention_marker(item) != "UNKNOWN"}
        state["attention_baselined"] = True
        state["coverage_version"] = 2
        return 0
    sent = 0
    for key in sorted(set(tracked) | set(current)):
        old = tracked.get(key, {"active": False, "bad": 0, "good": 0})
        item = current.get(key)
        if item:
            old["bad"] = min(BAD_POLLS, old.get("bad", 0) + 1)
            old["good"] = 0
            changed = old.get("active") and (
                old.get("severity") not in (None, item.get("severity"))
                or old.get("marker") not in (None, attention_marker(item))
            )
            old["title"] = item.get("title", key)
            if not old.get("active") and old["bad"] >= BAD_POLLS:
                if not snoozed(key):
                    publish("Code Black alert", f"{old['title']}\n{item.get('detail', '')}", attention_priority(item), "warning", key)
                    old["notified"] = True
                    sent += 1
                else:
                    old["notified"] = False
                old["active"] = True
            elif changed:
                if not snoozed(key):
                    publish("Code Black alert changed", f"{old['title']}\n{item.get('detail', '')}", attention_priority(item), "warning", key)
                    old["notified"] = True
                    sent += 1
                else:
                    old["notified"] = False
            elif old.get("active") and old.get("notified") is False and not snoozed(key):
                publish("Code Black alert", f"{old['title']}\n{item.get('detail', '')}", attention_priority(item), "warning", key)
                old["notified"] = True
                sent += 1
            old["severity"] = item.get("severity")
            old["marker"] = attention_marker(item)
        else:
            old["good"] = min(GOOD_POLLS, old.get("good", 0) + 1)
            old["bad"] = 0
            if old.get("active") and old["good"] >= GOOD_POLLS:
                # Core cold-start UNKNOWN telemetry can appear for seconds
                # while probes warm. If it was merely baselined, never page a
                # recovery for an issue we did not actually announce.
                if old.get("marker") != "UNKNOWN" or old.get("notified"):
                    if not snoozed(key):
                        publish("Code Black issue cleared", old.get("title", key), "default", "white_check_mark", key)
                        sent += 1
                old["active"] = False
        if old.get("active") or old.get("bad") or old.get("good", 0) < GOOD_POLLS:
            tracked[key] = old
        else:
            tracked.pop(key, None)
        save(STATE, state)
    return sent


def main():
    state = load(STATE, {})
    sent = 0
    errors = []
    try:
        sent += send_edge_events(state)
    except Exception as exc:
        errors.append(f"edge-events: {exc}")
    try:
        sent += send_other_edge_events(state)
    except Exception as exc:
        errors.append(f"other-edge-events: {exc}")
    try:
        sent += send_status_transitions(state)
    except Exception as exc:
        errors.append(f"status-center: {exc}")
    save(STATE, state)
    save(HEALTH, {"generated_at": utcnow(), "ok": not errors, "sent": sent, "errors": errors,
                  "event_offset": state.get("event_offset"), "attention_tracked": len(state.get("attention", {})),
                  "coverage": "all-status-attention-and-edge-events", "coverage_version": 2})
    print(f"ntfy bridge: sent={sent}, errors={len(errors)}")
    for error in errors:
        print(error)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
