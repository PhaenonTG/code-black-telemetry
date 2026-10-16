#!/usr/bin/env python3
"""Run an existing deployment and report its exact outcome over existing SSH."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "status-center"))
from project_inventory import validate_manifest, UNIT  # noqa: E402


def git_value(*args, root=ROOT):
    result = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, timeout=10)
    return result.stdout.strip() if result.returncode == 0 else None


def report(target, payload):
    command = "sudo python3 /srv/codeblack/services/project-landscape/project_inventory.py record"
    if payload["host"] == "edge":
        command = "python3 /srv/codeblack/services/project-landscape/project_inventory.py record --config /srv/codeblack/services/project-landscape/config"
    result = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", target,
                             command],
                            input=json.dumps(payload), text=True, capture_output=True, timeout=30)
    if result.returncode:
        raise RuntimeError("Project deployment report failed; check SSH access and the installed project-landscape helper.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", required=True, help="Existing SSH target")
    parser.add_argument("--host-id", default="core")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--unit", required=True)
    parser.add_argument("--release", required=True, help="family/version under /srv/codeblack/releases")
    parser.add_argument("--report-only", choices=("succeeded", "failed"))
    parser.add_argument("--source-root", type=Path, default=ROOT, help="Exact clean Git worktree containing the deployed package")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.host.startswith("-") or any(c.isspace() for c in args.host):
        parser.error("Invalid SSH host")
    unit = args.unit if args.unit.endswith((".service", ".timer")) else args.unit + ".service"
    if not UNIT.fullmatch(unit):
        parser.error("Invalid service unit")
    manifest = validate_manifest(json.loads(Path(args.manifest).read_text(encoding="utf-8")))
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command and not args.report_only:
        parser.error("Supply the deployment command after --")
    source_root = args.source_root.resolve()
    top = git_value("rev-parse", "--show-toplevel", root=source_root)
    commit = git_value("rev-parse", "HEAD", root=source_root)
    dirty = git_value("status", "--porcelain", root=source_root)
    if not top or Path(top).resolve() != source_root or not commit or dirty is None:
        parser.error("Source root must be a readable Git worktree root")
    payload = {"manifest": manifest, "host": args.host_id, "unit": unit, "release": args.release,
               "commit": commit, "dirty": bool(dirty),
               "attempt": uuid.uuid4().hex, "result": "started"}
    try:
        report(args.host, payload)
    except (RuntimeError, subprocess.SubprocessError) as exc:
        print(str(exc), file=sys.stderr); return 2
    if args.report_only:
        code = 0 if args.report_only == "succeeded" else 1
    else:
        environment = dict(os.environ, CODEBLACK_DEPLOY_REPORT_ACTIVE="1")
        try:
            code = subprocess.run(command, env=environment).returncode
        except (OSError, KeyboardInterrupt):
            code = 130
    payload["result"] = "succeeded" if code == 0 else "failed"
    try:
        report(args.host, payload)
    except (RuntimeError, subprocess.SubprocessError) as exc:
        print(str(exc), file=sys.stderr); return code or 2
    return code


if __name__ == "__main__":
    raise SystemExit(main())
