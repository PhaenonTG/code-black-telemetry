"""Project landscape keeps phase notes separate from live health evidence."""

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.environ.setdefault("STATUS_CENTER_STATE_DIR", tempfile.mkdtemp(prefix="sc-projects-"))
import server  # noqa: E402


class ProjectLandscapeTests(unittest.TestCase):
    def test_every_project_service_resolves_to_registered_monitoring(self):
        ids = {service["id"] for service in server.REG["services"]}
        link_ids = {link["id"] for link in server.REG["links"]}
        self.assertTrue(server.REG["projects"])
        for project in server.REG["projects"]:
            self.assertFalse(set(project["service_ids"]) - ids, project["id"])
            self.assertFalse(set(project["link_ids"]) - link_ids, project["id"])

    def test_health_comes_from_current_services_not_project_phase(self):
        services = {"a": {"id": "a", "name": "A", "host": "core", "state": "HEALTHY",
                          "state_reason": "ok", "informational": False}}
        original = server.REG["projects"]
        try:
            server.REG["projects"] = [{"id": "pilot", "name": "Pilot", "phase": "LIVE",
                                       "summary": "Scope", "note": "Static note", "service_ids": ["a"],
                                       "link_ids": []}]
            self.assertEqual(server.build_projects(services, [])[0]["health"], "HEALTHY")
            self.assertEqual(server.build_projects(services, [])[0]["healthy_count"], 1)
            services["a"]["state"] = "UNKNOWN"
            self.assertEqual(server.build_projects(services, [])[0]["health"], "UNKNOWN")
            services["a"]["state"] = "OFFLINE"
            self.assertEqual(server.build_projects(services, [])[0]["health"], "DEGRADED")
            self.assertEqual(server.build_projects(services, [])[0]["troubled_count"], 1)
            services["a"]["informational"] = True
            self.assertEqual(server.build_projects(services, [])[0]["health"], "DEGRADED")
            server.REG["projects"][0]["service_ids"] = []
            self.assertEqual(server.build_projects(services, [])[0]["health"], "UNMONITORED")
        finally:
            server.REG["projects"] = original

    def test_project_history_distinguishes_missing_data_from_health(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "project-history.json")
            history = server.ProjectHistory(path)
            projects = [{"id": "pilot", "health": "HEALTHY"}]
            self.assertTrue(all(state == "NO_DATA" for state in history.summary(projects, 100000)["pilot"]["bins"]))
            history.observe(projects, 100000)
            history.observe([{"id": "pilot", "health": "DEGRADED"}], 100100)  # throttled
            history.observe([{"id": "pilot", "health": "DEGRADED"}], 100301)
            restored = server.ProjectHistory(path)
            bins = restored.summary(projects, 100301)["pilot"]["bins"]
            self.assertEqual(bins[-1], "DEGRADED")
            self.assertEqual(len(restored.samples), 2)


if __name__ == "__main__":
    unittest.main()
