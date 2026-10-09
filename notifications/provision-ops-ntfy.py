#!/usr/bin/env python3
"""Provision a least-privilege private ops topic on Core; never print secrets."""

import re
import secrets
import subprocess
from pathlib import Path

TOKEN_FILE = Path("/srv/codeblack/config/ntfy/ops-publisher-token.txt")
USER = "ops-watcher"
TOPIC = "ops-monitoring"


def run(*args, env=None):
    return subprocess.run(args, check=True, text=True, capture_output=True, env=env).stdout


def main():
    users = run("sudo", "-n", "ntfy", "user", "list")
    if f"user {USER} " not in users:
        password = secrets.token_urlsafe(36)
        run("sudo", "-n", "env", f"NTFY_PASSWORD={password}", "ntfy", "user", "add", USER)
    run("sudo", "-n", "ntfy", "access", USER, TOPIC, "write-only")
    run("sudo", "-n", "ntfy", "access", "glenn", TOPIC, "read-only")
    if not TOKEN_FILE.exists():
        output = run("sudo", "-n", "ntfy", "token", "add", "--label=edge-ops-bridge", USER)
        match = re.search(r"tk_[A-Za-z0-9]+", output)
        if not match:
            raise RuntimeError("ntfy did not return a token; inspect it locally on Core")
        TOKEN_FILE.write_text(match.group(0) + "\n", encoding="utf-8")
        TOKEN_FILE.chmod(0o600)
    print("ops-monitoring topic provisioned; glenn read-only, ops-watcher write-only; token saved privately")


if __name__ == "__main__":
    main()
