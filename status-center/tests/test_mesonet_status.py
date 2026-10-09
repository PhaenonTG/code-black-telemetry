"""Mesonet dashboard reports transport freshness without disclosing readings."""

import io
import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.environ.setdefault("STATUS_CENTER_STATE_DIR", tempfile.mkdtemp(prefix="sc-mesonet-"))
import server  # noqa: E402


class Response:
    status = 200

    def __init__(self, data):
        self.data = io.BytesIO(json.dumps(data).encode())

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self, limit):
        return self.data.read(limit)


class MesonetStatusTests(unittest.TestCase):
    def test_probe_interval_matches_live_reporting(self):
        probe = next(p for p in server.REG["probes"] if p["id"] == "mesonet_latest")
        self.assertEqual(probe["interval"], 2)

    def test_probe_retains_only_role_ages(self):
        private = {"wind": {"received_age_ms": 1200, "readings": {"wind_mps": 8}},
                   "weather": {"received_age_ms": 40000, "readings": {"latitude": 37.1}}}
        with patch.dict(os.environ, {"CODE_BLACK_MESONET_READ_TOKEN": "test-read-only"}), \
             patch.object(server.urllib.request, "urlopen", return_value=Response(private)) as fetch:
            ok, value, error, _ = server.run_mesonet_latest({"url": "http://127.0.0.1:8000/api/mesonet/v1/latest"})
        self.assertTrue(ok, error)
        self.assertEqual(value["json"], {"wind": 1200, "weather": 40000})
        self.assertNotIn("latitude", str(value))
        self.assertNotIn("test-read-only", str(value))
        self.assertEqual(fetch.call_args.args[0].get_header("Authorization"), "Bearer test-read-only")

    def test_missing_credential_never_looks_healthy(self):
        with patch.dict(os.environ, {"CODE_BLACK_MESONET_READ_TOKEN": ""}):
            ok, value, error, _ = server.run_mesonet_latest({"url": "http://127.0.0.1:8000/api/mesonet/v1/latest"})
        self.assertFalse(ok)
        self.assertIsNone(value)
        self.assertIn("credential unavailable", error)

    def test_service_uses_age_not_endpoint_http_200(self):
        svc = next(s for s in server.SERVICES if s["id"] == "nick-mesonet-wind")
        for age, expected in ((1200, "HEALTHY"), (10000, "DEGRADED"), (40000, "OFFLINE")):
            probe = server.Probe({"id": "mesonet_latest", "interval": "fast"})
            probe.record(True, {"status": 200, "json": {"wind": age, "weather": None}}, None, 4)
            with patch.object(server, "PROBES", {"mesonet_latest": probe}):
                observed = server.build_service(svc)
            self.assertEqual(observed["state"], expected)
            self.assertNotIn("readings", str(observed))


if __name__ == "__main__":
    unittest.main()
