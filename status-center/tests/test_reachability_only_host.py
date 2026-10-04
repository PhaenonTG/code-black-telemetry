"""Reachability-only hosts must not show invented or permanently stale metrics."""

import os
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
os.environ.setdefault("STATUS_CENTER_STATE_DIR", tempfile.mkdtemp(prefix="sc-reach-"))
import server  # noqa: E402


class ReachabilityOnlyHostTests(unittest.TestCase):
    def observe(self, peer_online, tailscale_fresh, peer_present=True):
        probe = server.Probe({"id": "tailscale", "interval": "host"})
        probe.record(True, {"peers": []}, None, 1)
        if not tailscale_fresh:
            probe.last_success -= probe.stale_after + 1
            probe.last_attempt -= probe.stale_after + 1
        peer = {"name": "raspberrypi", "online": peer_online, "path": "relayed"}
        with patch.object(server, "tail_peer", return_value=peer if peer_present else None), \
             patch.dict(server.PROBES, {"tailscale": probe}, clear=False):
            return server.build_host(server.HOSTS["raspberrypi"], [])

    def test_online_peer_has_fresh_reachability_not_stale_host_metrics(self):
        host = self.observe(True, True)
        self.assertEqual(host["state"], "HEALTHY")
        self.assertFalse(host["telemetry"]["stale"])
        self.assertEqual(host["collector"], "none")
        self.assertIn("no collector", host["state_reason"])
        self.assertIsNotNone(host["last_contact"])
        self.assertIsNone(host["cpu"]["percent"])

    def test_stale_tailnet_result_cannot_keep_peer_online(self):
        host = self.observe(True, False)
        self.assertEqual(host["state"], "OFFLINE")
        self.assertTrue(host["telemetry"]["stale"])
        self.assertIsNone(host["last_contact"])

    def test_fresh_offline_peer_is_offline_without_false_stale_warning(self):
        host = self.observe(False, True)
        self.assertEqual(host["state"], "OFFLINE")
        self.assertFalse(host["telemetry"]["stale"])

    def test_missing_peer_in_fresh_tailnet_result_is_offline(self):
        host = self.observe(False, True, peer_present=False)
        self.assertEqual(host["state"], "OFFLINE")
        self.assertFalse(host["telemetry"]["stale"])


if __name__ == "__main__":
    unittest.main()
