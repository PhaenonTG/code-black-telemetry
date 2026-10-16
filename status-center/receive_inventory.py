#!/usr/bin/env python3
"""Fixed-host inventory receiver invoked through existing authenticated SSH."""
import json
import sys
import tempfile
from pathlib import Path
from project_inventory import atomic_json, external_inventory


def receive(host, stream):
    if host not in ("phaenon3", "codex-cloud"):
        raise ValueError("unsupported inventory host")
    raw = stream.read(524289)
    if len(raw) > 524288:
        raise ValueError("inventory exceeds limit")
    value = json.loads(raw.lstrip("\ufeff"))
    # Reuse the reader's schema, source and freshness checks before publication.
    with tempfile.TemporaryDirectory(prefix="inventory-validate-") as directory:
        path = Path(directory) / "candidate.json"
        atomic_json(path, value)
        validated = external_inventory(path, host)
    if validated is None:
        raise ValueError("invalid or stale inventory document")
    atomic_json(Path("/srv/codeblack/data/status-center/external-project-inventory") / (host + ".json"), validated)
    print(json.dumps({"host": host, "accepted": True, "observed_at": validated["generated_at"]}))


if __name__ == "__main__":
    receive(sys.argv[1], sys.stdin)
