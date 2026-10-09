#!/usr/bin/env python3
"""One-shot Core-side probe for ntfy's iOS upstream wake-up request.

Run on Core. It publishes a harmless test to ops-monitoring and listens for
the hashed poll_request on ntfy.sh. No credentials or message text are logged.
"""

import hashlib
import json
import threading
import urllib.request
from pathlib import Path

BASE = "https://codeblack-core.tail1d0673.ts.net:8443"
TOPIC = "ops-monitoring"
TOKEN = Path("/srv/codeblack/config/ntfy/ops-publisher-token.txt")


def main():
    topic_hash = hashlib.sha256(f"{BASE}/{TOPIC}".encode()).hexdigest()
    upstream = f"https://ntfy.sh/{topic_hash}/json"
    got_poll = threading.Event()
    listening = threading.Event()
    errors = []

    def listen():
        try:
            with urllib.request.urlopen(upstream, timeout=14) as response:
                listening.set()
                for raw in response:
                    event = json.loads(raw)
                    if event.get("event") == "poll_request":
                        got_poll.set()
                        break
        except Exception as exc:
            errors.append(type(exc).__name__)
            listening.set()

    thread = threading.Thread(target=listen, daemon=True)
    thread.start()
    if not listening.wait(5):
        raise RuntimeError("upstream listener did not connect")
    request = urllib.request.Request(
        f"http://127.0.0.1:2586/{TOPIC}",
        data=b"iOS upstream wake-up diagnostic; no action needed.",
        headers={"Authorization": "Bearer " + TOKEN.read_text().strip(), "Title": "Code Black push diagnostic"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=8) as response:
        print("local_publish_http", response.status)
    print("upstream_poll_request_seen", got_poll.wait(12))
    if errors:
        print("upstream_listener_error", errors[0])


if __name__ == "__main__":
    main()
