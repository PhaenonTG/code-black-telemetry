#!/usr/bin/env python3
"""Recover the radar worker when its process is running but HTTP stops answering."""

import json
import os
import subprocess
import time
import urllib.request
from pathlib import Path

HEALTH_URL = "http://127.0.0.1:8787/api/v1/radar/health"
UNIT = "codeblack-radar-worker.service"
STATE = Path("/srv/codeblack/data/radar-worker/health-watchdog.json")
FAILURES_TO_RESTART = 4
MAX_CHECK_GAP_S = 180
RESTART_COOLDOWN_S = 900


def load_state():
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_state(state):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    temporary = STATE.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, STATE)


def should_restart(state, active, healthy, checked_at):
    state = dict(state)
    previous = float(state.get("last_check", 0))
    failures = int(state.get("failures", 0))
    if not active or healthy or checked_at - previous > MAX_CHECK_GAP_S or checked_at < previous:
        failures = 0
    if active and not healthy:
        failures += 1
    state.update(last_check=checked_at, failures=failures, healthy=bool(healthy) if active else None)
    restart = (active and not healthy and failures >= FAILURES_TO_RESTART
               and checked_at - float(state.get("last_restart", 0)) >= RESTART_COOLDOWN_S)
    if restart:
        state["last_restart"] = checked_at
        state["restart_count"] = int(state.get("restart_count", 0)) + 1
        state["failures"] = 0
    return state, restart


def health_ok():
    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=5) as response:
            return response.status == 200 and json.load(response).get("ok") is True
    except (OSError, ValueError, TimeoutError):
        return False


def main():
    active = subprocess.run(["systemctl", "is-active", "--quiet", UNIT], check=False).returncode == 0
    healthy = health_ok() if active else False
    state, restart = should_restart(load_state(), active, healthy, time.time())
    if restart:
        print(f"radar HTTP failed {FAILURES_TO_RESTART} consecutive checks; restarting {UNIT}", flush=True)
        result = subprocess.run(["systemctl", "restart", UNIT], check=False, timeout=30)
        state["restart_result"] = result.returncode
    save_state(state)
    print(f"radar watchdog: active={active} healthy={healthy} failures={state['failures']} restart={restart}")
    if restart and state["restart_result"] != 0:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
