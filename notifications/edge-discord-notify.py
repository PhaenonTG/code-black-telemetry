#!/usr/bin/env python3
"""Route operational alerts to ntfy, with one Discord outage fallback.

The Edge evaluator's JSONL log and the ntfy bridge own incident delivery.
This dispatcher retains the historical outbox as an audit trail, and uses the
Discord webhook only when private push is unavailable for two runs.
"""

import datetime as dt
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request

BASE = Path(os.environ.get("CODEBLACK_NOTIFICATION_DIR", "/srv/codeblack/data/notifications"))
OUTBOX, SENT = BASE / "outbox", BASE / "sent"
STATUS = Path(os.environ.get("CODEBLACK_NOTIFICATION_STATUS", "/srv/codeblack/data/status/notification-status.json"))
SECRET = Path(os.environ.get("CODEBLACK_DISCORD_WEBHOOK_FILE", "/etc/codeblack-discord-webhook"))
STATE = BASE / "emergency-fallback-state.json"
BRIDGE = Path(__file__).with_name("edge_ntfy_bridge.py")
BRIDGE_HEALTH = Path(os.environ.get("CODEBLACK_NTFY_BRIDGE_HEALTH", "/srv/codeblack/data/status/ntfy-bridge-status.json"))


def utcnow():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def load(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def valid_webhook():
    try:
        url = SECRET.read_text(encoding="utf-8").strip()
    except OSError:
        return ""
    return url if url.startswith(("https://discord.com/api/webhooks/", "https://discordapp.com/api/webhooks/")) else ""


def send_emergency(url, reason):
    payload = {"content": "🚨 Code Black emergency delivery fallback: private ntfy alerts are unavailable. "
                          "Check Core/ntfy and the Edge notification dispatcher. Operational alerts remain queued for retry. "
                          f"Reason: {reason[:250]}",
               "allowed_mentions": {"parse": []}}
    request = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"),
                                     headers={"Content-Type": "application/json", "User-Agent": "CodeBlack-EmergencyFallback/1.0"},
                                     method="POST")
    with urllib.request.urlopen(request, timeout=10) as response:
        if response.status < 200 or response.status >= 300:
            raise RuntimeError(f"Discord HTTP {response.status}")


def archive_outbox():
    """Archive the queue after the bridge succeeds, preserving audit history."""
    SENT.mkdir(parents=True, exist_ok=True)
    archived = 0
    for path in sorted(OUTBOX.glob("*.json")):
        if not path.is_file():
            continue
        event = load(path, {})
        kind = event.get("type")
        event["notification_delivery"] = {
            "provider": "ntfy" if kind in {"incident_start", "incident_update", "recovery"} else "status_only",
            "archived_at": utcnow(),
            "note": "Incident JSONL cursor owns ntfy delivery; informational queue events do not page.",
        }
        save(path, event)
        destination = SENT / path.name
        if destination.exists():
            destination = SENT / f"{path.stem}-{int(dt.datetime.now().timestamp())}{path.suffix}"
        shutil.move(str(path), str(destination))
        archived += 1
    return archived


def dispatch(run_bridge=None, send=send_emergency):
    OUTBOX.mkdir(parents=True, exist_ok=True)
    fallback = load(STATE, {"failures": 0, "announced": False})
    if run_bridge is None:
        def run_bridge():
            return subprocess.run([sys.executable, str(BRIDGE)], timeout=45,
                                  capture_output=True, text=True, check=False)
    error = None
    started = time.time()
    try:
        result = run_bridge()
        if result.returncode:
            error = (result.stdout or result.stderr or f"bridge exit {result.returncode}").strip()[-500:]
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
    webhook = valid_webhook()
    if error is None:
        archived = archive_outbox()
        fallback = {"failures": 0, "announced": False, "last_ok": utcnow()}
        outcome = "ntfy_healthy"
    else:
        archived = 0
        health = load(BRIDGE_HEALTH, {})
        try:
            fresh_health = BRIDGE_HEALTH.stat().st_mtime >= started - 1
        except OSError:
            fresh_health = False
        ntfy_unavailable = not (fresh_health and health.get("ntfy_delivery_ok") is True)
        if ntfy_unavailable:
            fallback["failures"] = int(fallback.get("failures", 0)) + 1
        else:
            fallback["failures"] = 0
            fallback["announced"] = False
        outcome = "ntfy_unavailable" if ntfy_unavailable else "bridge_degraded"
        if ntfy_unavailable and fallback["failures"] >= 2 and not fallback.get("announced") and webhook:
            try:
                send(webhook, error)
                fallback["announced"] = True
                fallback["announced_at"] = utcnow()
                outcome = "emergency_discord_sent"
            except Exception as exc:
                outcome = "emergency_discord_failed"
                error += f"; fallback: {type(exc).__name__}: {exc}"
    save(STATE, fallback)
    save(STATUS, {"generated_at": utcnow(), "provider": "ntfy", "enabled": True,
                  "configured": bool(webhook), "fallback": "discord-emergency-only",
                  "queue": {"outbox": len(list(OUTBOX.glob('*.json'))), "sent": len(list(SENT.glob('*.json')))},
                  "archived": archived, "last_result": outcome, "last_error": error,
                  "fallback_failures": fallback["failures"], "fallback_announced": fallback.get("announced", False)})
    print(f"notification dispatch: {outcome}; archived={archived}; queued={len(list(OUTBOX.glob('*.json')))}")
    return 0 if error is None or outcome == "emergency_discord_sent" else 1


if __name__ == "__main__":
    raise SystemExit(dispatch())
