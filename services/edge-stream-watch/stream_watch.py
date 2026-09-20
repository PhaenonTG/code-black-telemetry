#!/usr/bin/env python3
"""Normalize Facebook Live state and enqueue one Discord event per live transition.

The monitor never handles Discord credentials.  It writes to the existing Edge notification
outbox, whose dispatcher owns delivery, retry, sent/failed archives, and the Discord webhook.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

STATE_URL = os.environ.get(
    "CODEBLACK_STREAM_STATE_URL",
    "https://ops.codeblackwx.com/overlay-core/facebook-live-state",
)
OWNER = os.environ.get("CODEBLACK_STREAM_OWNER", "Nick Mounce")
PROVIDER = os.environ.get("CODEBLACK_STREAM_PROVIDER", "Facebook")
DATA_DIR = Path(os.environ.get("CODEBLACK_STREAM_DATA_DIR", "/srv/codeblack/data/status"))
STATE_FILE = DATA_DIR / "stream.json"
OUTBOX = Path(os.environ.get("CODEBLACK_NOTIFICATION_OUTBOX", "/srv/codeblack/data/notifications/outbox"))
TIMEOUT_SECONDS = float(os.environ.get("CODEBLACK_STREAM_TIMEOUT_SECONDS", "10"))


def utcnow() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def save_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as tmp:
        json.dump(payload, tmp, indent=2)
        tmp.write("\n")
        tmp_path = Path(tmp.name)
    tmp_path.replace(path)


def fetch_live_state() -> dict:
    request = urllib.request.Request(STATE_URL, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        if response.status != 200:
            raise RuntimeError(f"stream state HTTP {response.status}")
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("live"), bool):
        raise ValueError("stream state schema invalid")
    return payload


def event_for(payload: dict, observed_at: str) -> dict:
    return {
        "type": "stream_live",
        "time": observed_at,
        "severity": "info",
        "stream": {
            "owner": OWNER,
            "provider": PROVIDER,
            "title": payload.get("title") if isinstance(payload.get("title"), str) else None,
            "url": payload.get("url") if isinstance(payload.get("url"), str) else None,
        },
    }


def enqueue(event: dict) -> None:
    OUTBOX.mkdir(parents=True, exist_ok=True)
    stamp = event["time"].replace(":", "").replace("+", "_")
    save_json(OUTBOX / f"{stamp}-{event['type']}.json", event)


def main() -> int:
    previous = load_json(STATE_FILE)
    observed_at = utcnow()
    try:
        payload = fetch_live_state()
    except (OSError, ValueError, urllib.error.URLError, TimeoutError) as exc:
        # Preserve the last confirmed stream state; unknown must never invent an end or a new live event.
        save_json(STATE_FILE, {
            **previous,
            "schema": "codeblack.stream-state.v1",
            "source": PROVIDER,
            "availability": "unavailable",
            "checked_at": observed_at,
            "last_error": type(exc).__name__,
        })
        print(f"Stream state unavailable: {type(exc).__name__}")
        return 0

    live = payload["live"]
    was_live = previous.get("live") if previous.get("availability") == "available" else None
    state = {
        "schema": "codeblack.stream-state.v1",
        "source": PROVIDER,
        "availability": "available",
        "checked_at": observed_at,
        "last_known_at": observed_at,
        "live": live,
        "owner": OWNER,
        "title": payload.get("title") if isinstance(payload.get("title"), str) else None,
        "url": payload.get("url") if isinstance(payload.get("url"), str) else None,
        "last_error": None,
    }
    save_json(STATE_FILE, state)
    # The first successful probe establishes a baseline.  A later false -> true transition emits once.
    if was_live is False and live:
        enqueue(event_for(payload, observed_at))
        print("Stream transitioned live; notification queued.")
    else:
        print("Stream state recorded; no notification transition.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
