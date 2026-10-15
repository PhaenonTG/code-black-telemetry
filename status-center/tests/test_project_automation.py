"""Deployment outcomes, runtime attribution, coverage and stale evidence."""
import copy
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import project_inventory as inventory
import project_landscape as landscape


MANIFEST = {"schema": "codeblack.project.v1", "id": "test-project", "name": "Test project", "summary": "A real deployed component", "phase": "LIVE",
            "services": [{"id": "test-service", "name": "Test", "host": "core", "unit": "codeblack-test.service"}], "links": []}
UNIT = {"state": "HEALTHY", "release": "test/v2", "active": "active", "sub": "running", "artifact_fingerprint": "signature"}


def report(**changes):
    value = {"manifest": MANIFEST, "host": "core", "unit": "codeblack-test.service", "release": "test/v2",
             "commit": "abcdef1234567", "attempt": "attempt-1", "result": "started", "dirty": False}
    return {**value, **changes}


def document(**changes):
    value = {"generated_at": "2026-10-15T00:00:00Z", "available": True, "projects": [inventory.validate_manifest(MANIFEST)],
             "units": {"codeblack-test.service": UNIT}, "deployments": {}, "errors": []}
    return {**value, **changes}


class ProjectAutomationTests(unittest.TestCase):
    def test_new_manifest_appears_without_registry_or_restart(self):
        projects, coverage = landscape.reconcile([], [], {}, [], {"core": (document(), True)})
        self.assertEqual(projects[0]["id"], "test-project")
        self.assertEqual(projects[0]["health"], "HEALTHY")
        self.assertEqual(projects[0]["deployment_state"], "UNVERIFIED")
        self.assertIn("UNVERIFIED", projects[0]["phase"])
        self.assertEqual(coverage["discovered_projects"], 0)

    def test_unregistered_service_appears_and_stale_host_never_stays_green(self):
        doc = document(projects=[])
        projects, coverage = landscape.reconcile([], [], {}, [], {"core": (doc, True)})
        self.assertEqual(projects[0]["registration"], "DISCOVERED")
        self.assertTrue(any(f["kind"] == "UNREGISTERED_UNIT" for f in coverage["findings"]))
        projects, _ = landscape.reconcile([], [], {}, [], {"core": (doc, False)})
        self.assertEqual(projects[0]["health"], "UNKNOWN")
        self.assertEqual(projects[0]["deployments"][0]["state"], "UNKNOWN")

    def test_receipt_must_match_running_release_and_clean_source(self):
        success = report(result="succeeded", artifact_fingerprint="signature")
        doc = document(deployments={"codeblack-test.service": {"last_success": success, "latest_attempt": success}})
        projects, _ = landscape.reconcile([], [], {}, [], {"core": (doc, True)})
        self.assertEqual(projects[0]["deployment_state"], "VERIFIED")
        self.assertEqual(projects[0]["phase"], "LIVE")
        for change in ({"release": "test/v1"}, {"dirty": True}, {"artifact_fingerprint": "changed"}):
            broken = copy.deepcopy(doc)
            broken["deployments"]["codeblack-test.service"]["last_success"].update(change)
            projects, _ = landscape.reconcile([], [], {}, [], {"core": (broken, True)})
            self.assertEqual(projects[0]["deployment_state"], "UNVERIFIED")
            self.assertIsNone(projects[0]["deployments"][0]["commit"])

    def test_failed_attempt_is_visible_even_if_previous_release_still_healthy(self):
        success = report(result="succeeded")
        doc = document(deployments={"codeblack-test.service": {"last_success": success, "latest_attempt": report(result="failed")}})
        projects, _ = landscape.reconcile([], [], {}, [], {"core": (doc, True)})
        self.assertEqual(projects[0]["health"], "HEALTHY")
        self.assertEqual(projects[0]["deployments"][0]["state"], "FAILED")
        self.assertEqual(projects[0]["deployment_state"], "UNVERIFIED")

    def test_record_validation_atomic_store_and_superseded_attempt(self):
        if sys.platform == "win32":
            self.skipTest("POSIX deployment writer runs on Core and Edge; validated on target Linux")
        with tempfile.TemporaryDirectory() as directory:
            inventory.record(report(), directory)
            inventory.record(report(result="succeeded"), directory)
            records = json.loads((Path(directory) / "deployments.json").read_text())
            self.assertEqual(records["codeblack-test.service"]["last_success"]["commit"], "abcdef1234567")
            inventory.record(report(attempt="newer"), directory)
            with self.assertRaises(ValueError):
                inventory.record(report(result="failed"), directory)
            with self.assertRaises(ValueError):
                inventory.record(report(unit="codeblack-other.service"), directory)

    def test_manifest_rejects_paths_commands_and_secret_urls(self):
        for edit in ({"id": "../bad"}, {"services": [{"id": "a", "host": "core", "unit": "a;reboot"}]},
                     {"links": [{"id": "a", "name": "A", "url": "https://user:password@example.com/"}]}):
            with self.assertRaises(ValueError):
                inventory.validate_manifest({**MANIFEST, **edit})

    def test_timer_covers_service_without_duplicate_discovery(self):
        doc = document(projects=[])
        doc["units"] = {"codeblack-test.timer": {"state": "HEALTHY", "triggers": ["codeblack-test.service"]}, "codeblack-test.service": UNIT}
        config = [{"id": "job", "host": "core", "unit": "codeblack-test.timer"}]
        project = {"id": "job", "name": "Job", "phase": "DEVELOPMENT", "summary": "Job", "note": "Job", "service_ids": ["job"], "link_ids": []}
        services = {"job": {"id": "job", "name": "Job", "host": "core", "state": "HEALTHY", "state_reason": "waiting"}}
        projects, coverage = landscape.reconcile([project], config, services, [], {"core": (doc, True)})
        self.assertEqual(len(projects), 1)
        self.assertEqual(coverage["discovered_projects"], 0)

    def test_manifest_membership_replaces_old_scope_and_can_bind_http_service_unit(self):
        base = {"id": "test-project", "name": "Old", "phase": "DEVELOPMENT", "summary": "Old", "note": "Old", "service_ids": ["old"], "link_ids": ["old-link"]}
        configs = [{"id": "test-service", "host": "core"}]
        services = {"test-service": {"id": "test-service", "name": "Test", "host": "core", "state": "DEGRADED", "state_reason": "HTTP probe failed"}}
        projects, coverage = landscape.reconcile([base], configs, services, [], {"core": (document(), True)})
        self.assertEqual(projects[0]["service_ids"], ["test-service"])
        self.assertEqual(projects[0]["link_ids"], [])
        self.assertEqual(projects[0]["health"], "DEGRADED")  # retain the functional probe authority
        self.assertEqual(coverage["discovered_projects"], 0)

    def test_discovery_failure_preserves_previous_inventory(self):
        if sys.platform == "win32":
            self.skipTest("Linux collector discovery is validated on target")
        old_cache = dict(inventory.CACHE)
        try:
            inventory.CACHE.update(at=0, value=document())
            with tempfile.TemporaryDirectory() as directory, patch.object(inventory, "discover_units", side_effect=RuntimeError()):
                value = inventory.collect(Path(directory), Path(directory))
                self.assertFalse(value["available"])
                self.assertIn("codeblack-test.service", value["units"])
        finally:
            inventory.CACHE.update(old_cache)

    def test_deploy_wrapper_reports_failed_command_and_returns_failure(self):
        path = Path(__file__).resolve().parents[2] / "scripts" / "deploy_with_status.py"
        spec = importlib.util.spec_from_file_location("deploy_with_status", path)
        wrapper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(wrapper)
        with tempfile.TemporaryDirectory() as directory:
            manifest = Path(directory) / "project.json"
            manifest.write_text(json.dumps(MANIFEST))
            argv = ["deploy_with_status.py", "--host", "codeblack-core", "--manifest", str(manifest), "--unit", "codeblack-test", "--release", "test/v2", "--", "deploy-command"]
            reported = []
            with patch.object(sys, "argv", argv), patch.object(wrapper, "git_value", side_effect=lambda *args: "abcdef1234567" if args[0] == "rev-parse" else ""), patch.object(wrapper, "report", side_effect=lambda host, payload: reported.append(copy.deepcopy(payload))), patch.object(wrapper.subprocess, "run", return_value=SimpleNamespace(returncode=17)):
                self.assertEqual(wrapper.main(), 17)
            self.assertEqual([r["result"] for r in reported], ["started", "failed"])
            self.assertEqual(reported[0]["attempt"], reported[1]["attempt"])


if __name__ == "__main__":
    unittest.main()
