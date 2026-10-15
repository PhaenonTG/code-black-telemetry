"""Merge declared projects with fresh deployment and discovery evidence."""
from copy import deepcopy


def unit_name(value):
    return value if value.endswith((".service", ".timer")) else value + ".service"


def reconcile(base_projects, service_config, service_by_id, links, inventories):
    entries = {p["id"]: deepcopy(p) for p in base_projects}
    services = dict(service_by_id)
    configs = {s["id"]: s for s in service_config}
    extra_links, findings, host_status = [], [], []
    manifests = {}
    for host, info in inventories.items():
        doc, fresh = info
        doc = doc or {}
        available = bool(fresh and doc.get("available"))
        host_status.append({"host": host, "state": "CURRENT" if available else "UNAVAILABLE", "observed_at": doc.get("generated_at")})
        if not available:
            findings.append({"kind": "DISCOVERY_UNAVAILABLE", "host": host, "detail": "Inventory cannot establish new deployments on this host."})
        for error in doc.get("errors", []):
            findings.append({**error, "host": host, "detail": "Project metadata or discovery needs attention."})
        for manifest in doc.get("projects", []):
            pid = manifest["id"]
            if pid not in manifests:
                manifests[pid] = deepcopy(manifest)
            else:
                # A manifest is authoritative for bindings on its own host.
                old = manifests[pid]
                local = [s for s in manifest["services"] if s["host"] == host]
                old["services"] = [s for s in old["services"] if s["host"] != host] + local
        for sid, config in configs.items():
            if config.get("host") != host or not config.get("unit") or sid not in services:
                continue
            unit = unit_name(config["unit"])
            observation = doc.get("units", {}).get(unit)
            services[sid] = {**services[sid], "deployment": deployment(doc, unit, observation, available)}
    for pid, manifest in manifests.items():
        entry = entries.setdefault(pid, {"id": pid, "service_ids": [], "link_ids": []})
        entry.update({k: manifest[k] for k in ("name", "phase", "summary", "note")})
        entry["registration"] = "MANIFEST"
        for item in manifest["services"]:
            sid, host = item["id"], item["host"]
            if sid in configs and configs[sid].get("host") != host:
                findings.append({"kind": "SERVICE_CONFLICT", "host": host, "detail": f"{sid} conflicts with the registered host."})
                continue
            if sid not in entry["service_ids"]:
                entry["service_ids"].append(sid)
            if sid not in services:
                doc, fresh = inventories.get(host, ({}, False))
                doc = doc or {}
                observation = doc.get("units", {}).get(item.get("unit"))
                services[sid] = dynamic_service(item, doc, observation, bool(fresh and doc.get("available")))
            if item.get("unit"):
                configs.setdefault(sid, {"id": sid, "host": host, "unit": item["unit"]})
                doc, fresh = inventories.get(host, ({}, False))
                observation = (doc or {}).get("units", {}).get(item["unit"])
                if fresh and (doc or {}).get("available") and (not observation or not observation.get("installed", True)):
                    findings.append({"kind": "MISSING_UNIT", "host": host, "detail": f"{item['unit']} is declared but not installed."})
            elif sid not in service_by_id:
                findings.append({"kind": "UNMONITORED_SERVICE", "host": host, "detail": f"{sid} has neither a functional probe nor a process check."})
        for link in manifest["links"]:
            link = {**link, "id": pid + ":" + link["id"]}
            extra_links.append(link)
            if link["id"] not in entry["link_ids"]:
                entry["link_ids"].append(link["id"])
    scoped = {sid for project in entries.values() for sid in project["service_ids"]}
    covered_units = {(config["host"], unit_name(config["unit"])) for sid, config in configs.items() if sid in scoped and config.get("unit")}
    for host, (doc, _fresh) in inventories.items():
        for unit, observed in (doc or {}).get("units", {}).items():
            if unit.endswith(".timer") and (host, unit) in covered_units:
                covered_units.update((host, target) for target in observed.get("triggers", []))
    for host, (doc, fresh) in inventories.items():
        if not doc:
            continue
        available = bool(fresh and doc.get("available"))
        units = doc.get("units", {})
        for unit, observation in units.items():
            if not unit.startswith("codeblack") or (host, unit) in covered_units:
                continue
            # A service and its timer form one discovered project.
            stem = unit.rsplit(".", 1)[0]
            pid = f"discovered-{host}-{stem}"
            sid = f"auto-{host}-{unit}"
            item = {"id": sid, "name": unit, "host": host, "unit": unit}
            services[sid] = dynamic_service(item, doc, observation, available)
            entry = entries.setdefault(pid, {"id": pid, "name": stem, "phase": "DISCOVERED / UNVERIFIED",
                "summary": f"Automatically discovered on {host}. Register a project manifest to declare its purpose and functional checks.",
                "note": "Process state only. Runtime presence does not establish a qualified deployment.",
                "service_ids": [], "link_ids": [], "registration": "DISCOVERED"})
            entry["service_ids"].append(sid)
            findings.append({"kind": "UNREGISTERED_UNIT", "host": host, "detail": f"{unit} has no project binding."})
    links_by_id = {item["id"]: item for item in links + extra_links}
    result = []
    for entry in entries.values():
        monitored = [services[sid] for sid in entry["service_ids"] if sid in services]
        missing = [sid for sid in entry["service_ids"] if sid not in services]
        states = [s["state"] for s in monitored]
        good = {"HEALTHY", "LIVE", "ONLINE"}
        trouble = {"OFFLINE", "FAILED", "CRITICAL", "DEGRADED", "WARNING", "STALE"}
        health = "UNMONITORED" if not monitored else "DEGRADED" if missing or any(s in trouble for s in states) else "UNKNOWN" if any(s not in good for s in states) else "HEALTHY"
        deployments = [s["deployment"] for s in monitored if s.get("deployment")]
        verified = bool(deployments) and all(d["state"] == "VERIFIED" for d in deployments) and health == "HEALTHY"
        declared = entry["phase"]
        # A LIVE milestone from a manifest is never promoted based on a receipt alone.
        phase = declared if "LIVE" not in declared.upper() else declared if verified else declared + " / UNVERIFIED"
        result.append({**entry, "phase": phase, "declared_phase": declared, "phase_source": "DECLARED MILESTONE",
            "registration": entry.get("registration", "REGISTRY"), "deployment_state": "VERIFIED" if verified else "UNVERIFIED",
            "health": health, "monitored_count": len(monitored), "expected_count": len(entry["service_ids"]),
            "healthy_count": sum(s in good for s in states), "troubled_count": sum(s in trouble for s in states),
            "unknown_count": sum(s not in good | trouble for s in states), "missing_services": missing,
            "services": [{k: s.get(k) for k in ("id", "name", "host", "state", "state_reason", "deployment", "monitoring_kind")} for s in monitored],
            "links": [links_by_id[lid] for lid in entry["link_ids"] if lid in links_by_id], "deployments": deployments})
    for sid in sorted(set(services) - scoped):
        if not sid.startswith("auto-"):
            findings.append({"kind": "UNASSIGNED_SERVICE", "host": services[sid].get("host"), "detail": f"{sid} is monitored but has no project assignment."})
    return result, {"hosts": host_status, "findings": findings[:512], "finding_count": len(findings),
                    "registered_projects": sum(p["registration"] != "DISCOVERED" for p in result),
                    "discovered_projects": sum(p["registration"] == "DISCOVERED" for p in result)}


def deployment(doc, unit, observation, fresh):
    receipt = doc.get("deployments", {}).get(unit, {})
    success = receipt.get("last_success", {})
    attempt = receipt.get("latest_attempt", {})
    release = (observation or {}).get("release")
    matching = bool(release and success.get("release") == release and success.get("commit") and not success.get("dirty")
                    and success.get("artifact_fingerprint") and success.get("artifact_fingerprint") == (observation or {}).get("artifact_fingerprint"))
    state = "UNKNOWN" if not fresh else "FAILED" if attempt.get("result") == "failed" else "DEPLOYING" if attempt.get("result") == "started" else "VERIFIED" if matching and observation.get("state") == "HEALTHY" else "UNVERIFIED"
    return {"unit": unit, "state": state, "release": release, "commit": success.get("commit") if matching else None,
            "deployed_at": success.get("reported_at") if matching else None, "last_attempt": attempt or None,
            "runtime_started_at": (observation or {}).get("runtime_started_at"), "observed_at": doc.get("generated_at"),
            "evidence": "Deployment receipt matched to observed release and process state; functional checks remain separate."}


def dynamic_service(item, doc, observation, fresh):
    state = (observation or {}).get("state", "UNKNOWN") if fresh else "UNKNOWN"
    # Inactive one-shot jobs are healthy only with a live schedule and an observed successful run.
    if state == "IDLE":
        scheduled = any(u.get("state") == "HEALTHY" and item.get("unit") in u.get("triggers", []) for name, u in doc.get("units", {}).items() if name.endswith(".timer"))
        state = "HEALTHY" if scheduled and observation.get("runtime_started_at") and observation.get("result") == "success" else "UNKNOWN"
    return {"id": item["id"], "name": item["name"], "host": item["host"], "state": state,
            "state_reason": f"{(observation or {}).get('active', 'unavailable')}/{(observation or {}).get('sub', 'unknown')}; process/schedule evidence only" if fresh else "Host discovery telemetry unavailable",
            "monitoring_kind": "PROCESS_ONLY", "deployment": deployment(doc, item.get("unit", ""), observation, fresh)}
