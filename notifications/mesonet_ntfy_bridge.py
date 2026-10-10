#!/usr/bin/env python3
"""Mirror every durable Nick mesonet alert transition to private ops ntfy."""

import datetime as dt
import json
import os
import sqlite3
import urllib.request
import urllib.parse
from contextlib import closing
from pathlib import Path

DB = Path(os.environ.get("CODEBLACK_MESONET_DB", "/srv/codeblack/data/mesonet/management/commands.sqlite"))
STATE = Path(os.environ.get("CODEBLACK_MESONET_NTFY_STATE", "/srv/codeblack/data/mesonet/management/ntfy-bridge-state.json"))
HEALTH = Path(os.environ.get("CODEBLACK_MESONET_NTFY_HEALTH", "/srv/codeblack/data/status-center/mesonet-ntfy/health.json"))
TOKEN = Path(os.environ.get("CODEBLACK_MESONET_NTFY_TOKEN", "/srv/codeblack/data/mesonet/management/ops-publisher-token.txt"))
NTFY_URL = os.environ.get("CODEBLACK_MESONET_NTFY_URL", "http://127.0.0.1:2586/ops-monitoring")
DASHBOARD_URL = "https://codeblack-core.tail1d0673.ts.net/status/"
ACTION_URL = "https://codeblack-core.tail1d0673.ts.net/alert-actions"
ACTION_STATE_URL = "http://127.0.0.1:8796/api/state"
LABELS = {"offline": "offline", "stale": "short-stale telemetry", "reboot_loop": "reboot loop", "update_failed": "OTA update failure"}


def save(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def load(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def rows():
    with closing(sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=5)) as connection:
        return connection.execute(
            "SELECT id, role, kind, resolved FROM mesonet_alerts ORDER BY id"
        ).fetchall()


def publish(alert_id, role, kind, resolved, was_open):
    label = LABELS.get(kind, kind.replace("_", " "))
    if resolved is None:
        title = f"Nick {role.upper()}: {label}"
        body = f"Alert {alert_id} is active. Check private Core management and Status Center."
        priority, tags = "high", "warning"
    else:
        title = f"Nick {role.upper()}: {label} cleared"
        body = f"Alert {alert_id} resolved." if was_open else f"Alert {alert_id} opened and cleared between notification checks."
        priority, tags = "default", "white_check_mark"
    token = TOKEN.read_text(encoding="utf-8").strip()
    if not token:
        raise RuntimeError("mesonet publisher token empty")
    incident_id = f"mesonet:{alert_id}"
    incident_url = ACTION_URL + "/incident?id=" + urllib.parse.quote(incident_id, safe="")
    request = urllib.request.Request(
        NTFY_URL,
        data=body.encode("utf-8"),
        headers={"Authorization": "Bearer " + token, "Title": title, "Priority": priority,
                 "Tags": tags, "Click": incident_url,
                 "Actions": f"view, Open Status, {DASHBOARD_URL}; view, View Incident, {incident_url}",
                 "User-Agent": "CodeBlack-Mesonet-OpsBridge/1.0"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=8) as response:
        if response.status != 200:
            raise RuntimeError(f"ntfy HTTP {response.status}")


def snoozed(alert_id):
    try:
        with urllib.request.urlopen(ACTION_STATE_URL, timeout=2) as response:
            state = json.load(response).get(f"mesonet:{alert_id}", {})
        until = state.get("snoozed_until")
        return bool(until and dt.datetime.fromisoformat(until.replace("Z", "+00:00")) > dt.datetime.now(dt.timezone.utc))
    except (OSError, ValueError, TypeError):
        return False


def main():
    sent = 0
    error = None
    state = load(STATE, {})
    try:
        current = rows()
        seen = state.setdefault("seen", {})
        if not state.get("baselined"):
            state["seen"] = {str(alert_id): "open" if resolved is None else "resolved"
                             for alert_id, _role, _kind, resolved in current}
            state["baselined"] = True
            save(STATE, state)
        else:
            present = set()
            for alert_id, role, kind, resolved in current:
                key = str(alert_id)
                present.add(key)
                new_state = "open" if resolved is None else "resolved"
                old_state = seen.get(key)
                if old_state != new_state:
                    if not snoozed(alert_id):
                        publish(alert_id, role, kind, resolved, old_state == "open")
                        sent += 1
                    seen[key] = new_state
                    save(STATE, state)
            state["seen"] = {key: value for key, value in seen.items() if key in present}
            save(STATE, state)
        active = sum(resolved is None for _id, _role, _kind, resolved in current)
        tracked = len(current)
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
        active = tracked = None
    save(HEALTH, {"generated_at": dt.datetime.now(dt.timezone.utc).isoformat(), "ok": error is None,
                  "sent": sent, "active": active, "tracked": tracked, "error": error,
                  "coverage": "offline,stale,reboot_loop,update_failed"})
    print(f"mesonet ntfy bridge: sent={sent}, ok={error is None}")
    if error:
        print(error)
    return 1 if error else 0


if __name__ == "__main__":
    raise SystemExit(main())
