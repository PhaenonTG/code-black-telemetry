"""Chase-aware radar status must never relay source coordinates to the browser."""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.environ.setdefault("STATUS_CENTER_STATE_DIR", tempfile.mkdtemp(prefix="sc-radar-control-"))
import server  # noqa: E402


class RadarControlStatusTests(unittest.TestCase):
    def test_missing_endpoint_is_explicitly_not_deployed(self):
        view = server.radar_control_view(None, {"stale": True})
        self.assertEqual(view["state"], "NOT_DEPLOYED")
        self.assertEqual(view["mode"], "NOT_CONFIGURED")

    def test_view_keeps_selection_ids_but_removes_coordinates(self):
        raw = {
            "state": "ready", "mode": "observer",
            "fabric": {"state": "fresh", "snapshot_age_s": 12, "eligible_chasers": 2, "skipped_chasers": 0,
                       "raw_location": {"lat": 37.215, "lon": -93.298}},
            "selection": {"primary": [{"site_id": "KSGF", "distance_km": 32.1, "lat": 37.2}], "secondary": []},
            "work": {"active_site": "KSGF", "queued_sites": 0},
            "capabilities": {"closest_site_selection": "available", "secondary_prewarm": "not_configured", "configuration_ui": "not_deployed"},
        }
        view = server.radar_control_view(raw, {"stale": False})
        self.assertEqual(view["selection"]["primary"], [{"site_id": "KSGF", "distance_km": 32.1}])
        self.assertNotIn("37.215", json.dumps(view))
        self.assertNotIn("-93.298", json.dumps(view))


if __name__ == "__main__":
    unittest.main()
