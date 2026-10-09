"""Send new AEGIS discussion-audit messages to a private ntfy topic.

Run once per minute with pythonw.exe. Existing messages are baselined on first
run; a durable cursor prevents duplicate alerts on later runs.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import urllib.request
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

MAX_BODY_BYTES = 3000


def save_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(state, separators=(",", ":")), encoding="utf-8")
    os.replace(temporary, path)


def chunks(text: str) -> list[str]:
    if not text:
        return ["[No message text; possibly an attachment]"]
    parts, current, size = [], [], 0
    for character in text:
        n = len(character.encode("utf-8"))
        if size + n > MAX_BODY_BYTES and current:
            parts.append("".join(current))
            current, size = [], 0
        current.append(character)
        size += n
    if current:
        parts.append("".join(current))
    return parts


def publish(endpoint: str, token: str, title: str, body: str) -> None:
    request = urllib.request.Request(
        endpoint,
        data=body.encode("utf-8"),
        method="POST",
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "text/plain; charset=utf-8",
            "X-Title": title,
            "X-Priority": "4",
            "X-Tags": "speech_balloon",
        },
    )
    with urllib.request.urlopen(request, timeout=8) as response:
        if response.status != 200:
            raise RuntimeError(f"ntfy returned HTTP {response.status}")


def run(config: dict, *, publish_message=publish) -> int:
    database = Path(config["database"])
    state_path = Path(config["state_file"])
    token = Path(config["token_file"]).read_text(encoding="utf-8").strip()
    if not token:
        raise ValueError("ntfy publish token is empty")
    user_id = config["user_id"]
    endpoint = config["endpoint"]
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=5)) as db:
        if not state_path.exists():
            latest = db.execute(
                "SELECT created_at, message_id FROM discussion_audit WHERE user_id=? "
                "ORDER BY created_at DESC, message_id DESC LIMIT 1", (user_id,),
            ).fetchone()
            save_state(state_path, {"created_at": latest[0] if latest else "", "message_id": latest[1] if latest else ""})
            return 0
        state = json.loads(state_path.read_text(encoding="utf-8"))
        rows = db.execute(
            "SELECT message_id, created_at, session_id, role, content FROM discussion_audit "
            "WHERE user_id=? AND (created_at>? OR (created_at=? AND message_id>?)) "
            "ORDER BY created_at, message_id LIMIT 100",
            (user_id, state["created_at"], state["created_at"], state["message_id"]),
        ).fetchall()
    sent = 0
    for message_id, created_at, session_id, role, content in rows:
        if role not in ("user", "assistant"):
            state.update(created_at=created_at, message_id=message_id)
            save_state(state_path, state)
            continue
        pieces = chunks(content or "")
        start = state.get("next_part", 0) if state.get("pending_id") == message_id else 0
        for index in range(start, len(pieces)):
            direction = "Silas to AEGIS" if role == "user" else "AEGIS to Silas"
            part = f" ({index + 1}/{len(pieces)})" if len(pieces) > 1 else ""
            title = f"{direction} [{session_id[:8]}]{part}"
            publish_message(endpoint, token, title, pieces[index])
            state.update(pending_id=message_id, next_part=index + 1)
            save_state(state_path, state)
            sent += 1
        state.update(created_at=created_at, message_id=message_id)
        state.pop("pending_id", None)
        state.pop("next_part", None)
        save_state(state_path, state)
    return sent


def main() -> int:
    try:
        config = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
        run(config)
        if config.get("heartbeat_file"):
            save_state(Path(config["heartbeat_file"]), {"at": datetime.now(timezone.utc).isoformat()})
        return 0
    except Exception as exc:
        # The scheduled task records a failure; never log message bodies/tokens.
        print(f"Silas AEGIS notifier failed: {type(exc).__name__}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
