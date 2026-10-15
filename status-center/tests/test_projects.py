"""Project landscape keeps phase notes separate from live health evidence."""

import os
import sys
import tempfile
import unittest

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
            services["a"]["state"] = "UNKNOWN"
            self.assertEqual(server.build_projects(services, [])[0]["health"], "UNKNOWN")
            services["a"]["state"] = "OFFLINE"
            self.assertEqual(server.build_projects(services, [])[0]["health"], "DEGRADED")
            services["a"]["informational"] = True
            self.assertEqual(server.build_projects(services, [])[0]["health"], "DEGRADED")
            server.REG["projects"][0]["service_ids"] = []
            self.assertEqual(server.build_projects(services, [])[0]["health"], "UNMONITORED")
        finally:
            server.REG["projects"] = original


if __name__ == "__main__":
    unittest.main()
