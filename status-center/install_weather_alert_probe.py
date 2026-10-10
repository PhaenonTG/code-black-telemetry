#!/usr/bin/env python3
"""Guarded Edge collector registry update for the weather-alert health file."""

import json
import os
from pathlib import Path
import shutil
import time

REGISTRY = Path("/srv/codeblack/services/status-collector/registry.json")
NAME = "weather-alert-health"
ENTRY = {"name": NAME,
         "path": "/srv/codeblack/shared/discord-bot/weather-alert-health.json",
         "pick": ["checked_at", "ok", "reason", "area", "area_mode", "channel", "sources"]}
PREVIOUS_ENTRY = {**ENTRY, "pick": ["checked_at", "ok", "reason", "area", "channel", "sources"]}


def transform(document):
    edge = next(host for host in document["hosts"] if host["id"] == "edge")
    files = edge["checks"]["files"]
    matches = [entry for entry in files if entry.get("name") == NAME]
    if matches:
        if len(matches) == 1 and matches[0] == ENTRY:
            return document, False
        if len(matches) == 1 and matches[0] == PREVIOUS_ENTRY:
            files[files.index(matches[0])] = ENTRY
            return document, True
        raise ValueError("weather alert collector entry differs; refusing overwrite")
    files.append(ENTRY)
    return document, True


def main():
    original = REGISTRY.read_text(encoding="utf-8")
    updated, changed = transform(json.loads(original))
    if not changed:
        print("weather alert probe already installed")
        return
    backup = REGISTRY.with_name("registry.pre-weather-alert-" + time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + ".json")
    if backup.exists():
        raise SystemExit("backup exists; refusing overwrite")
    shutil.copy2(REGISTRY, backup)
    temporary = REGISTRY.with_name(REGISTRY.name + ".weather-tmp")
    temporary.write_text(json.dumps(updated, indent=2) + "\n", encoding="utf-8")
    os.chmod(temporary, REGISTRY.stat().st_mode)
    os.replace(temporary, REGISTRY)
    print("weather alert health file configured in Edge collector registry")


if __name__ == "__main__":
    main()
