"""Notification overview must distinguish pipeline health from iPhone delivery."""

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.environ.setdefault("STATUS_CENTER_STATE_DIR", tempfile.mkdtemp(prefix="sc-notifications-"))
import server  # noqa: E402


class NotificationOverviewTests(unittest.TestCase):
    def test_live_route_states_and_mobile_push_caveat(self):
        services = {
            sid: {"id": sid, "state": state, "last_success": "2026-10-09T20:00:00Z"}
            for sid, state in (
                ("ntfy-private", "HEALTHY"),
                ("edge-ntfy-bridge", "DEGRADED"),
                ("nick-mesonet-ntfy-bridge", "HEALTHY"),
                ("silas-aegis-notify", "UNKNOWN"),
                ("edge-notification-dispatch", "HEALTHY"),
            )
        }
        overview = server.build_notifications(services)
        self.assertEqual(overview["server"]["state"], "HEALTHY")
        self.assertEqual([route["state"] for route in overview["channels"]],
                         ["DEGRADED", "HEALTHY", "UNKNOWN"])
        self.assertEqual(overview["fallback"]["state"], "HEALTHY")
        self.assertEqual(overview["iphone"]["push"], "UNVERIFIED")
        self.assertEqual(overview["iphone"]["inbox"], "CONFIRMED")

    def test_missing_service_is_unknown_and_configuration_is_secret_free(self):
        overview = server.build_notifications({})
        self.assertEqual(overview["server"]["state"], "UNKNOWN")
        self.assertTrue(all(route["state"] == "UNKNOWN" for route in overview["channels"]))
        self.assertEqual(overview["fallback"]["state"], "UNKNOWN")
        self.assertFalse({"password", "token", "credential", "secret"} & set(str(overview).lower().split()))


if __name__ == "__main__":
    unittest.main()
