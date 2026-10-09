#!/usr/bin/env python3
"""Forward actionable Edge and Status Center transitions to private ntfy.

The existing Edge evaluator owns infrastructure incidents. Status Center owns
service-level attention. This bridge only delivers transitions; it does not
create a second monitoring authority or re-page existing conditions on install.
"""

import datetime as dt
import json
import os
import time
import urllib.request
from pathlib import Path

EVENTS = Path(os.environ.get("CODEBLACK_ALERT_EVENTS", "/srv/codeblack/data/alerts/events.jsonl"))
STATE = Path(os.environ.get("CODEBLACK_NTFY_BRIDGE_STATE", "/srv/codeblack/data/notifications/ntfy-bridge-state.json"))
HEALTH = Path(os.environ.get("CODEBLACK_NTFY_BRIDGE_HEALTH", "/srv/codeblack/data/status/ntfy-bridge-status.json"))
TOKEN = Path(os.environ.get("CODEBLACK_NTFY_OPS_TOKEN", "/srv/codeblack/private/ntfy/ops-publisher-token.txt"))
STATUS_URL = os.environ.get("CODEBLACK_STATUS_URL", "https://codeblack-core.tail1d0673.ts.net/status/api/status")
NTFY_URL = os.environ.get("CODEBLACK_NTFY_URL", "https://codeblack-core.tail1d0673.ts.net:8443/ops-monitoring")
DASHBOARD_URL = "https://codeblack-core.tail1d0673.ts.net/status/"
IGNORED_ATTENTION = {"host:hytetower", "svc:nick-mesonet-wind", "svc:nick-mesonet-weather"}
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


def publish(title, body, priority="default", tags="warning"):
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
            "Click": DASHBOARD_URL,
            "User-Agent": "CodeBlack-Edge-OpsBridge/1.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=8) as response:
        if response.status != 200:
            raise RuntimeError(f"ntfy HTTP {response.status}")


def issue_keys(event):
    return sorted(str(issue).split(":", 1)[0] for issue in event.get("issues", []))


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
            if kind not in {"incident_start", "incident_update", "recovery"}:
                state["event_offset"] = next_offset
                continue
            keys = issue_keys(event)
            if kind == "incident_update" and keys == state.get("last_edge_issue_keys"):
                state["event_offset"] = next_offset
                continue
            title = {"incident_start": "Code Black incident", "incident_update": "Code Black incident changed", "recovery": "Code Black recovered"}[kind]
            body = "\n".join(str(x) for x in event.get("issues", [])[:12]) or "Infrastructure recovered."
            publish(title, body, "high" if kind != "recovery" else "default", "rotating_light" if kind != "recovery" else "white_check_mark")
            state["event_offset"] = next_offset
            state["last_edge_issue_keys"] = keys if kind != "recovery" else []
            sent += 1
            save(STATE, state)  # restart-safe delivery cursor
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
        if item.get("severity") in {"WARNING", "ERROR", "CRITICAL"}
        and item.get("id") not in IGNORED_ATTENTION
    }


def send_status_transitions(state):
    current = get_attention()
    tracked = state.setdefault("attention", {})
    if not state.get("attention_baselined"):
        for key, item in current.items():
            tracked[key] = {"active": True, "bad": BAD_POLLS, "good": 0, "title": item.get("title", key)}
        state["attention_baselined"] = True
        return 0
    sent = 0
    for key in sorted(set(tracked) | set(current)):
        old = tracked.get(key, {"active": False, "bad": 0, "good": 0})
        item = current.get(key)
        if item:
            old["bad"] = min(BAD_POLLS, old.get("bad", 0) + 1)
            old["good"] = 0
            old["title"] = item.get("title", key)
            if not old.get("active") and old["bad"] >= BAD_POLLS:
                publish("Code Black needs attention", f"{old['title']}\n{item.get('detail', '')}", "high", "warning")
                old["active"] = True
                sent += 1
        else:
            old["good"] = min(GOOD_POLLS, old.get("good", 0) + 1)
            old["bad"] = 0
            if old.get("active") and old["good"] >= GOOD_POLLS:
                publish("Code Black issue cleared", old.get("title", key), "default", "white_check_mark")
                old["active"] = False
                sent += 1
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
        sent += send_status_transitions(state)
    except Exception as exc:
        errors.append(f"status-center: {exc}")
    save(STATE, state)
    save(HEALTH, {"generated_at": utcnow(), "ok": not errors, "sent": sent, "errors": errors,
                  "event_offset": state.get("event_offset"), "attention_tracked": len(state.get("attention", {}))})
    print(f"ntfy bridge: sent={sent}, errors={len(errors)}")
    for error in errors:
        print(error)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
