#!/usr/bin/env python3

import datetime
import json
import subprocess
import shutil
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


BASE = Path("/srv/codeblack/data/notifications")
OUTBOX = BASE / "outbox"
SENT = BASE / "sent"
FAILED = BASE / "failed"

STATUS_FILE = Path(
    "/srv/codeblack/data/status/notification-status.json"
)

CONFIG_FILE = Path(
    "/etc/codeblack-notifications.json"
)

SECRET_FILE = Path(
    "/etc/codeblack-discord-webhook"
)


for directory in (OUTBOX, SENT, FAILED):
    directory.mkdir(
        parents=True,
        exist_ok=True
    )

# The private iPhone channel is additive. A Core/ntfy outage must never block
# the existing Discord fallback or consume its outbox.
bridge = Path(__file__).with_name("edge_ntfy_bridge.py")
if bridge.exists():
    try:
        subprocess.run([sys.executable, str(bridge)], timeout=25, check=False)
    except Exception as exc:
        print(f"ntfy bridge unavailable: {exc}")


def utcnow():
    return datetime.datetime.now(
        datetime.timezone.utc
    ).isoformat()


def load_json(path, default=None):
    try:
        return json.loads(
            path.read_text()
        )
    except Exception:
        return default if default is not None else {}


def save_json(path, payload):
    tmp = path.with_suffix(
        path.suffix + ".tmp"
    )

    tmp.write_text(
        json.dumps(
            payload,
            indent=2
        ) + "\n"
    )

    tmp.replace(path)


def queue_counts():
    return {
        "outbox": len(
            list(
                OUTBOX.glob("*.json")
            )
        ),
        "sent": len(
            list(
                SENT.glob("*.json")
            )
        ),
        "failed": len(
            list(
                FAILED.glob("*.json")
            )
        ),
    }


def write_status(
    *,
    enabled,
    configured,
    provider,
    last_result=None,
    last_error=None,
):
    payload = {
        "generated_at": utcnow(),
        "provider": provider,
        "enabled": enabled,
        "configured": configured,
        "queue": queue_counts(),
        "last_result": last_result,
        "last_error": last_error,
    }

    save_json(
        STATUS_FILE,
        payload
    )


def read_secret():
    try:
        value = SECRET_FILE.read_text().strip()
    except Exception:
        return ""

    if not value.startswith(
        "https://discord.com/api/webhooks/"
    ) and not value.startswith(
        "https://discordapp.com/api/webhooks/"
    ):
        return ""

    return value


def event_title(event):
    kind = event.get(
        "type",
        "event"
    )

    if kind == "incident_start":
        return "🚨 Code Black Infrastructure Incident"

    if kind == "incident_update":
        return "⚠️ Code Black Incident Update"

    if kind == "recovery":
        return "✅ Code Black Infrastructure Recovered"

    if kind == "test":
        return "🧪 Code Black Notification Test"

    if kind == "stream_live":
        stream = event.get("stream", {})
        owner = stream.get("owner", "Code Black") if isinstance(stream, dict) else "Code Black"
        return f"🔴 {owner} is LIVE"

    return "Code Black Infrastructure Event"


def event_color(event):
    kind = event.get(
        "type",
        ""
    )

    if kind == "recovery":
        return 0x57F287

    if kind == "test":
        return 0x5865F2

    if kind == "stream_live":
        return 0xED4245

    if kind == "incident_update":
        return 0xFEE75C

    return 0xED4245


def summarize(event):
    if event.get("type") == "stream_live":
        stream = event.get("stream", {})
        provider = stream.get("provider", "the stream provider") if isinstance(stream, dict) else "the stream provider"
        return f"Live on {provider}."

    issues = event.get(
        "issues",
        []
    )

    if issues:
        issue_text = "\n".join(
            f"• {issue}"
            for issue in issues[:20]
        )
    else:
        issue_text = (
            "No active infrastructure issues."
        )

    return issue_text


def discord_payload(
    event,
    username,
):
    status_snapshot = event.get(
        "status_snapshot",
        {}
    )

    functional = event.get(
        "functional_snapshot",
        {}
    )

    core = status_snapshot.get(
        "core",
        {}
    )

    backup = status_snapshot.get(
        "backup",
        {}
    )

    api = functional.get(
        "core_api",
        {}
    )

    mqtt = functional.get(
        "mqtt",
        {}
    )

    fields = []

    fields.append({
        "name": "Event",
        "value": event.get(
            "type",
            "unknown"
        ),
        "inline": True,
    })

    fields.append({
        "name": "Severity",
        "value": event.get(
            "severity",
            "unknown"
        ),
        "inline": True,
    })

    if event.get("type") == "stream_live":
        stream = event.get("stream", {})
        if isinstance(stream, dict):
            fields.append({
                "name": "Stream",
                "value": stream.get("provider", "Unknown provider"),
                "inline": True,
            })
            url = stream.get("url")
            if isinstance(url, str) and url.startswith("https://"):
                fields.append({
                    "name": "Watch",
                    "value": url,
                    "inline": False,
                })

    if core:
        fields.append({
            "name": "Core",
            "value": (
                f"SSH: "
                f"{'OK' if core.get('ssh_reachable') else 'DOWN'}\n"
                f"Tailscale: "
                f"{'OK' if core.get('tailscale_reachable') else 'DOWN'}\n"
                f"Failed services: "
                f"{core.get('failed_services', 'unknown')}"
            ),
            "inline": True,
        })

    if api:
        fields.append({
            "name": "Core API",
            "value": (
                f"{'OK' if api.get('ok') else 'FAILED'}"
                f" • HTTP "
                f"{api.get('http_code', 'unknown')}"
            ),
            "inline": True,
        })

    if mqtt:
        fields.append({
            "name": "MQTT",
            "value": (
                f"{'Reachable' if mqtt.get('tcp_reachable') else 'FAILED'}"
            ),
            "inline": True,
        })

    if backup:
        fields.append({
            "name": "Backup",
            "value": (
                f"Age: "
                f"{backup.get('age_minutes', 'unknown')} min\n"
                f"Repos: "
                f"{backup.get('repository_count', 'unknown')}"
            ),
            "inline": True,
        })

    embed = {
        "title": event_title(event),
        "description": summarize(event),
        "color": event_color(event),
        "timestamp": event.get(
            "time",
            utcnow()
        ),
        "fields": fields,
        "footer": {
            "text": "CodeBlack-Edge • Stream Watch" if event.get("type") == "stream_live" else "CodeBlack-Edge • Infrastructure Watchdog"
        },
    }

    return {
        "username": username,
        "allowed_mentions": {
            "parse": []
        },
        "embeds": [
            embed
        ],
    }


def post_discord(
    webhook,
    payload,
    timeout,
):
    body = json.dumps(
        payload
    ).encode("utf-8")

    request = urllib.request.Request(
        webhook + "?wait=true",
        data=body,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "CodeBlack-Edge/1.0",
        },
        method="POST",
    )

    with urllib.request.urlopen(
        request,
        timeout=timeout
    ) as response:
        code = response.getcode()

        if code < 200 or code >= 300:
            raise RuntimeError(
                f"Discord HTTP {code}"
            )

        return code


config = load_json(
    CONFIG_FILE,
    {}
)

provider = config.get(
    "provider",
    "discord"
)

enabled = bool(
    config.get(
        "enabled",
        False
    )
)

username = config.get(
    "username",
    "Code Black Edge"
)

max_attempts = int(
    config.get(
        "max_attempts",
        3
    )
)

timeout = int(
    config.get(
        "request_timeout_seconds",
        10
    )
)

webhook = read_secret()
configured = bool(webhook)

queued_files = sorted(
    OUTBOX.glob("*.json")
)


if not enabled:
    write_status(
        enabled=False,
        configured=configured,
        provider=provider,
        last_result=(
            "delivery_disabled"
        ),
    )

    print(
        "Notification delivery disabled; queue preserved."
    )

    raise SystemExit(0)


if provider != "discord":
    write_status(
        enabled=enabled,
        configured=False,
        provider=provider,
        last_result="unsupported_provider",
        last_error=(
            f"Unsupported provider: {provider}"
        ),
    )

    raise SystemExit(1)


if not configured:
    write_status(
        enabled=True,
        configured=False,
        provider=provider,
        last_result="missing_webhook",
        last_error=(
            "Discord webhook is not configured."
        ),
    )

    print(
        "Discord delivery enabled but webhook is missing."
    )

    raise SystemExit(1)


if not queued_files:
    write_status(
        enabled=True,
        configured=True,
        provider=provider,
        last_result="queue_empty",
    )

    print(
        "Notification queue empty."
    )

    raise SystemExit(0)


overall_failure = False


for path in queued_files:
    event = load_json(
        path,
        {}
    )

    if not event:
        target = FAILED / path.name

        shutil.move(
            str(path),
            str(target)
        )

        overall_failure = True

        continue

    payload = discord_payload(
        event,
        username
    )

    delivered = False
    error_text = None

    for attempt in range(
        1,
        max_attempts + 1
    ):
        try:
            code = post_discord(
                webhook,
                payload,
                timeout
            )

            delivered = True

            event[
                "notification_delivery"
            ] = {
                "provider": "discord",
                "delivered_at": utcnow(),
                "http_status": code,
                "attempt": attempt,
            }

            save_json(
                path,
                event
            )

            break

        except Exception as exc:
            error_text = str(exc)

            if attempt < max_attempts:
                time.sleep(
                    min(
                        2 ** attempt,
                        8
                    )
                )

    if delivered:
        target = SENT / path.name

        shutil.move(
            str(path),
            str(target)
        )

        print(
            f"SENT: {path.name}"
        )

    else:
        event[
            "notification_delivery"
        ] = {
            "provider": "discord",
            "failed_at": utcnow(),
            "error": error_text,
            "attempts": max_attempts,
        }

        save_json(
            path,
            event
        )

        target = FAILED / path.name

        shutil.move(
            str(path),
            str(target)
        )

        print(
            f"FAILED: {path.name}: {error_text}"
        )

        overall_failure = True


write_status(
    enabled=True,
    configured=True,
    provider=provider,
    last_result=(
        "delivery_failure"
        if overall_failure
        else "delivery_success"
    ),
    last_error=(
        "One or more notifications failed."
        if overall_failure
        else None
    ),
)


raise SystemExit(
    1 if overall_failure else 0
)
