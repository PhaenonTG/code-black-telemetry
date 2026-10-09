#!/usr/bin/env python3

import datetime
import json
import os
import time
from pathlib import Path

STATUS_FILE = Path(
    os.environ.get(
        "CODEBLACK_STATUS_FILE",
        "/srv/codeblack/data/status/status.json",
    )
)

PROBES_FILE = Path(
    os.environ.get(
        "CODEBLACK_PROBES_FILE",
        "/srv/codeblack/data/status/functional-probes.json",
    )
)

NTFY_BRIDGE_FILE = Path(
    os.environ.get(
        "CODEBLACK_NTFY_BRIDGE_FILE",
        "/srv/codeblack/data/status/ntfy-bridge-status.json",
    )
)

DATA_DIR = Path(
    os.environ.get(
        "CODEBLACK_ALERT_DATA_DIR",
        "/srv/codeblack/data/alerts",
    )
)

OUTBOX = Path(
    os.environ.get(
        "CODEBLACK_NOTIFICATION_OUTBOX",
        "/srv/codeblack/data/notifications/outbox",
    )
)

EXPECTED_REPOS = int(
    os.environ.get(
        "CODEBLACK_EXPECTED_REPOS",
        "2",
    )
)

DEBOUNCE_BAD = int(
    os.environ.get(
        "CODEBLACK_DEBOUNCE_BAD",
        "3",
    )
)

DEBOUNCE_GOOD = int(
    os.environ.get(
        "CODEBLACK_DEBOUNCE_GOOD",
        "2",
    )
)

MAX_TELEMETRY_AGE_SECONDS = int(
    os.environ.get("CODEBLACK_MAX_TELEMETRY_AGE_SECONDS", "180")
)

STATE_FILE = DATA_DIR / "state.json"
EVENTS_FILE = DATA_DIR / "events.jsonl"
LATEST_FILE = DATA_DIR / "latest-event.json"

def now():
    return datetime.datetime.now(
        datetime.timezone.utc
    ).isoformat()

def load(path, default):
    try:
        return json.loads(path.read_text())
    except Exception:
        return default

def telemetry_fresh(path):
    try:
        return 0 <= time.time() - path.stat().st_mtime <= MAX_TELEMETRY_AGE_SECONDS
    except OSError:
        return False

def save(path, data):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(
        json.dumps(data, indent=2) + "\n"
    )
    os.replace(tmp, path)

def emit(event):
    with EVENTS_FILE.open("a") as fh:
        fh.write(
            json.dumps(event, separators=(",", ":"))
            + "\n"
        )

    save(LATEST_FILE, event)

    OUTBOX.mkdir(
        parents=True,
        exist_ok=True,
    )

    stamp = (
        event["time"]
        .replace(":", "")
        .replace("+", "_")
    )

    save(
        OUTBOX / f"{stamp}-{event['type']}.json",
        event,
    )

DATA_DIR.mkdir(
    parents=True,
    exist_ok=True,
)

OUTBOX.mkdir(
    parents=True,
    exist_ok=True,
)

status = load(STATUS_FILE, {})
probes = load(PROBES_FILE, {})

issues = []

# A stopped collector must never leave the last healthy snapshot green.
if not telemetry_fresh(STATUS_FILE):
    issues.append("edge_status_telemetry_stale")
if not telemetry_fresh(PROBES_FILE):
    issues.append("functional_probe_telemetry_stale")
if not telemetry_fresh(NTFY_BRIDGE_FILE) or not load(NTFY_BRIDGE_FILE, {}).get("ok"):
    issues.append("ops_ntfy_bridge_unhealthy")

core = status.get("core", {})
edge = status.get("edge", {})
backup = status.get("backup", {})

# ------------------------------------------------------------
# Infrastructure reachability
# ------------------------------------------------------------

if not core.get("tailscale_reachable", False):
    issues.append("core_tailscale_unreachable")

if not core.get("ssh_reachable", False):
    issues.append("core_ssh_unreachable")

core_failed = core.get("failed_services", -1)

if isinstance(core_failed, int) and core_failed > 0:
    issues.append(
        f"core_failed_services:{core_failed}"
    )

edge_failed = edge.get("failed_services", -1)

if isinstance(edge_failed, int) and edge_failed > 0:
    issues.append(
        f"edge_failed_services:{edge_failed}"
    )

disk = edge.get("root_disk_used_percent", -1)

if isinstance(disk, int):
    if disk >= 95:
        issues.append(
            f"edge_disk_critical:{disk}"
        )
    elif disk >= 85:
        issues.append(
            f"edge_disk_warning:{disk}"
        )

# ------------------------------------------------------------
# Backup health
# ------------------------------------------------------------

if not backup.get("present", False):
    issues.append("backup_missing")

elif not backup.get("complete", False):
    issues.append("backup_incomplete")

age = backup.get("age_minutes", -1)

if isinstance(age, int) and age >= 0:
    if age > 2880:
        issues.append(
            f"backup_critical_stale:{age}"
        )
    elif age > 1560:
        issues.append(
            f"backup_stale:{age}"
        )

repos = backup.get("repository_count", -1)

if isinstance(repos, int) and repos != EXPECTED_REPOS:
    issues.append(
        f"backup_repository_count:{repos}"
    )

# ------------------------------------------------------------
# Functional health
# ------------------------------------------------------------

if probes:

    if not probes.get(
        "core_ssh",
        {}
    ).get(
        "ok",
        False
    ):
        issues.append(
            "functional_core_ssh_failed"
        )

    if not probes.get(
        "core_api",
        {}
    ).get(
        "ok",
        False
    ):
        issues.append(
            "core_api_http_probe_failed"
        )

    if not probes.get(
        "mqtt",
        {}
    ).get(
        "tcp_reachable",
        False
    ):
        issues.append(
            "mqtt_tcp_probe_failed"
        )

    # PHAENON3 (ai-router GPU/learning-queue ops health, added 2026-09-23).
    # Each specific problem ops_health.py reports becomes its own issue
    # string, same granularity as the Core checks above, rather than one
    # generic "phaenon3 degraded" -- so Discord shows exactly what's wrong
    # (e.g. phaenon3_orphaned_llama_server_processes) instead of requiring a
    # follow-up look to find out.
    phaenon3 = probes.get(
        "phaenon3",
        {}
    )

    if not phaenon3.get(
        "ok",
        False
    ):
        issues.append(
            "phaenon3_probe_unreachable"
        )
    else:
        for phaenon3_problem in (
            phaenon3.get("problems")
            or []
        ):
            # High VRAM occupancy is normal for this dedicated GPU workload.
            # Keep the metric, but alert on actual failures and leaked runners.
            if phaenon3_problem == "vram_above_90_percent":
                continue
            issues.append(
                f"phaenon3_{phaenon3_problem}"
            )

else:
    issues.append(
        "functional_probe_data_missing"
    )

# ------------------------------------------------------------
# ROLE-AWARE FLEET HEALTH
# ------------------------------------------------------------

try:
    fleet = json.loads(
        Path(
            "/srv/codeblack/data/status/fleet-presence.json"
        ).read_text()
    )
except Exception:
    fleet = {}

for fleet_issue in fleet.get(
    "critical_issues",
    []
):
    issues.append(
        fleet_issue
    )

currently_bad = bool(issues)

state = load(
    STATE_FILE,
    {
        "incident_active": False,
        "bad_count": 0,
        "good_count": 0,
        "incident_started_at": None,
        "last_issues": [],
        "last_reported_issues": [],
        "last_transition_at": None,
    },
)

event = None

if currently_bad:

    state["bad_count"] = \
        state.get("bad_count", 0) + 1

    state["good_count"] = 0

    previous = state.get(
        "last_reported_issues",
        [],
    )

    state["last_issues"] = issues

    if (
        not state.get(
            "incident_active",
            False,
        )
        and
        state["bad_count"] >= DEBOUNCE_BAD
    ):
        timestamp = now()

        state["incident_active"] = True
        state["incident_started_at"] = timestamp
        state["last_transition_at"] = timestamp

        event = {
            "type": "incident_start",
            "time": timestamp,
            "severity": "degraded",
            "issues": issues,
            "status_snapshot": status,
            "functional_snapshot": probes,
        }

    elif (
        state.get(
            "incident_active",
            False,
        )
        and previous != issues
    ):
        event = {
            "type": "incident_update",
            "time": now(),
            "severity": "degraded",
            "issues": issues,
            "status_snapshot": status,
            "functional_snapshot": probes,
        }

else:

    state["good_count"] = \
        state.get("good_count", 0) + 1

    state["bad_count"] = 0

    if (
        state.get(
            "incident_active",
            False,
        )
        and
        state["good_count"] >= DEBOUNCE_GOOD
    ):
        timestamp = now()

        event = {
            "type": "recovery",
            "time": timestamp,
            "severity": "healthy",
            "issues": state.get(
                "last_issues",
                [],
            ),
            "incident_started_at":
                state.get(
                    "incident_started_at"
                ),
            "status_snapshot": status,
            "functional_snapshot": probes,
        }

        state["incident_active"] = False
        state["incident_started_at"] = None
        state["last_transition_at"] = timestamp
        state["last_issues"] = []

if event:

    emit(event)

    state["last_reported_issues"] = (
        issues if currently_bad else []
    )

state["current_health"] = (
    "degraded"
    if currently_bad
    else "healthy"
)

state["current_issues"] = issues
state["last_evaluated_at"] = now()

save(STATE_FILE, state)

print(json.dumps({
    "health": state["current_health"],
    "incident_active":
        state.get("incident_active", False),
    "bad_count":
        state.get("bad_count", 0),
    "good_count":
        state.get("good_count", 0),
    "issues": issues,
    "event_emitted": event,
}, indent=2))
