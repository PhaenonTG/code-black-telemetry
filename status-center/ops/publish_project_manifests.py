#!/usr/bin/env python3
"""Publish validated project metadata without redeploying application services."""
import argparse
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "status-center"))
from project_inventory import atomic_json, validate_manifest  # noqa: E402


def remote_register(target, command, value):
    result = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", target, command],
                            input=json.dumps(value), text=True, capture_output=True, timeout=30)
    if result.returncode:
        raise RuntimeError(f"Manifest registration failed on {target}; existing services were not restarted.")


def publish(directory, local_directory, core="codeblack-core", edge="codeblack-edge", check_only=False):
    # Validate the entire batch before any writes. Atomic replacement per manifest
    # makes an interrupted publication safe to retry. No receipt about application
    # code is created: a metadata publication is not a binary deployment.
    paths = sorted(Path(directory).glob("*.json"))
    if not paths or len(paths) > 128:
        raise ValueError("invalid manifest batch")
    values = [validate_manifest(json.loads(p.read_text(encoding="utf-8-sig"))) for p in paths]
    ids = [value["id"] for value in values]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate project IDs")
    identities, bindings = {}, {}
    for value in values:
        for service in value["services"]:
            key = (service["host"], service.get("unit") or ("task:" + service["task"].lstrip("\\").casefold() if service.get("task") else None))
            if service["id"] in identities and identities[service["id"]] != key:
                raise ValueError("service ID has conflicting host/process bindings")
            identities[service["id"]] = key
            if key[1] is not None:
                if key in bindings and bindings[key] != service["id"]:
                    raise ValueError("one process is assigned conflicting service IDs")
                bindings[key] = service["id"]
    if check_only:
        print(json.dumps({"validated_projects": len(values), "unique_services": len(identities), "process_bindings": len(bindings)}))
        return
    for value in values:
        remote_register(core, "sudo python3 /srv/codeblack/services/project-landscape/project_inventory.py register", value)
        remote_register(edge, "python3 /srv/codeblack/services/project-landscape/project_inventory.py register --config /srv/codeblack/services/project-landscape/config", value)
        atomic_json(Path(local_directory) / (value["id"] + ".json"), value)
    print(json.dumps({"published_projects": len(values), "hosts": ["core", "edge", "phaenon3"], "application_services_restarted": False}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifests", default=str(ROOT / ".codeblack" / "projects"))
    parser.add_argument("--local-directory", default="C:/CodeBlack/config/project-landscape/projects.d")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    publish(args.manifests, args.local_directory, check_only=args.check)
