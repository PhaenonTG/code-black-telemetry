"""EDGE reachability without a raw TCP connection to its HTTPS listener."""

import os
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
os.environ.setdefault("STATUS_CENTER_STATE_DIR", tempfile.mkdtemp(prefix="sc-edge-"))
import server  # noqa: E402


class InternetProbe:
    last_error = None


class EdgeProbeTests(unittest.TestCase):
    def test_registry_has_no_raw_https_tcp_probe(self):
        probes = {p["id"]: p for p in server.REG["probes"]}
        self.assertNotIn("edge_tcp", probes)
        self.assertIn("edge_collector", probes)
        dashboard = next(link for link in server.REG["links"] if link["id"] == "edge-dashboard")
        self.assertTrue(dashboard["verify"])
        self.assertTrue(dashboard["url"].startswith("https://codeblack-edge."))

    def observe(self, online, fresh):
        peer = {"name": "codeblack-edge", "ips": ["100.88.198.67"], "online": online,
                "path": "direct", "relay": None, "last_seen": None}
        tailscale = {"backend": "Running", "peers": [peer]}
        with patch.object(server, "pval", side_effect=lambda pid: tailscale if pid == "tailscale" else None), \
             patch.object(server, "pfresh_ok", side_effect=lambda pid: fresh if pid == "tailscale" else True), \
             patch.object(server, "coll", return_value=(None, None, False)), \
             patch.object(server, "tel", return_value={}), \
             patch.dict(server.PROBES, {"internet_dns": InternetProbe()}, clear=True):
            host = server.build_host(server.HOSTS["edge"], [])
            network = server.build_network({})
        pair = next(p for p in network["pairs"] if p["from"] == "core" and p["to"] == "edge")
        return host, pair, network["peers"][0]

    def test_online_edge_uses_fresh_tailnet_observation(self):
        host, pair, peer = self.observe(True, True)
        self.assertEqual(host["state"], "UNKNOWN")  # host up; collector telemetry absent
        self.assertEqual(pair["state"], "HEALTHY")
        self.assertEqual(pair["path"], "direct")
        self.assertIsNone(pair["latency_ms"])  # no synthetic TCP latency
        self.assertIsNone(peer["latency_ms"])

    def test_offline_edge_is_not_marked_healthy(self):
        host, pair, _ = self.observe(False, True)
        self.assertEqual(host["state"], "OFFLINE")
        self.assertEqual(pair["state"], "OFFLINE")

    def test_stale_tailnet_observation_fails_closed(self):
        host, pair, _ = self.observe(True, None)
        self.assertEqual(host["state"], "OFFLINE")
        self.assertEqual(pair["state"], "UNKNOWN")


if __name__ == "__main__":
    unittest.main()
