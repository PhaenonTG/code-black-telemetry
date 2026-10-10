"""Regression checks for operator-facing weather and storage severity."""

import os
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.environ.setdefault("STATUS_CENTER_STATE_DIR", tempfile.mkdtemp(prefix="sc-weather-"))
import server  # noqa: E402


class WeatherAndDiskStatusTests(unittest.TestCase):
    def test_watcher_uses_timer_trigger_when_oneshot_has_no_exit_timestamp(self):
        watcher = next(w for w in server.REG["weather"] if w["id"] == "hrrr-edge-watcher")
        units = {
            watcher["unit"]: {"active": "inactive", "result": "success", "last_exit": None},
            watcher["timer"]: {"last_trigger": "Fri 2026-10-09 09:00:00 UTC"},
        }
        doc = {"units": units}
        fixed_now = server.parse_ts("Fri 2026-10-09 09:05:00 UTC")
        with patch.dict(server.REG, {"weather": [watcher]}), \
             patch.object(server, "coll", return_value=(doc, {}, True)), \
             patch.object(server, "now", return_value=fixed_now):
            item = server.build_weather({})["items"][0]
        self.assertEqual(item["state"], "HEALTHY")
        self.assertEqual(item["last_success"], "2026-10-09T09:00:00Z")

    def test_failed_watcher_still_degrades(self):
        watcher = next(w for w in server.REG["weather"] if w["id"] == "hrrr-edge-watcher")
        doc = {"units": {
            watcher["unit"]: {"active": "failed", "result": "exit-code", "last_exit": None},
            watcher["timer"]: {"last_trigger": "Fri 2026-10-09 09:00:00 UTC"},
        }}
        with patch.dict(server.REG, {"weather": [watcher]}), \
             patch.object(server, "coll", return_value=(doc, {}, True)), \
             patch.object(server, "now", return_value=server.parse_ts("Fri 2026-10-09 09:05:00 UTC")):
            item = server.build_weather({})["items"][0]
        self.assertEqual(item["state"], "DEGRADED")
        self.assertIn("exit-code", item["error"])

    def test_disk_severity_preserves_warning_and_true_critical(self):
        self.assertEqual(server.disk_state({"percent": 94.2, "free_gb": 53.7}), "WARNING")
        self.assertEqual(server.disk_state({"percent": 97.5, "free_gb": 25}), "CRITICAL")
        self.assertEqual(server.disk_state({"percent": 50, "free_gb": 9}), "CRITICAL")

    def test_phaenon3_disk_alert_begins_at_97_percent(self):
        self.assertEqual(server.disk_state({"percent": 95.4, "free_gb": 43.1}, "phaenon3"), "HEALTHY")
        self.assertEqual(server.disk_state({"percent": 97, "free_gb": 27.9}, "phaenon3"), "WARNING")
        self.assertEqual(server.disk_state({"percent": 99, "free_gb": 9.3}, "phaenon3"), "CRITICAL")

    def test_busy_compute_is_not_an_incident_transition(self):
        self.assertEqual(server.state_rank("BUSY"), server.state_rank("HEALTHY"))

    def test_attention_includes_informational_and_unknown_services(self):
        host = {"id": "edge", "name": "EDGE", "state": "HEALTHY", "state_reason": None,
                "expected_online": True, "disks": []}
        service = {"id": "optional", "name": "Optional feed", "host": "edge", "state": "OFFLINE",
                   "state_reason": "not publishing", "informational": True, "critical": False, "urls": {}}
        with patch.object(server, "FIRST_SEEN", {}), patch.object(server, "probes_warmed", return_value=False):
            items = server.build_attention([host], [service], {"sources": []}, {"state": "FRESH"},
                                           {"items": []}, {"instances": []}, {"backups": []}, {}, {})
            self.assertEqual(items[0]["id"], "svc:optional")
            self.assertEqual(items[0]["severity"], "INFO")
            service.update(state="UNKNOWN", informational=False)
            items = server.build_attention([host], [service], {"sources": []}, {"state": "FRESH"},
                                           {"items": []}, {"instances": []}, {"backups": []}, {}, {})
            self.assertEqual(items[0]["severity"], "WARNING")

    def test_attention_since_survives_restart_and_resets_after_recovery(self):
        host = {"id": "hytetower", "name": "HYTETOWER", "state": "OFFLINE",
                "state_reason": "peer offline", "expected_online": True, "disks": []}
        def attention():
            return server.build_attention([host], [], {"sources": []}, {"state": "FRESH"},
                                          {"items": []}, {"instances": []}, {"backups": []}, {}, {})
        with tempfile.TemporaryDirectory(prefix="sc-attention-") as directory, \
             patch.object(server, "STATE_DIR", directory), \
             patch.object(server, "ATTENTION_FILE", os.path.join(directory, "attention-first-seen.json")), \
             patch.object(server, "FIRST_SEEN", {}), \
             patch.object(server, "probes_warmed", return_value=True):
            with patch.object(server, "now", return_value=1_700_000_000.0):
                first = attention()[0]["since"]
                self.assertTrue(os.path.exists(server.ATTENTION_FILE))
                server.FIRST_SEEN.clear()  # simulate a process restart
                server.FIRST_SEEN.update(server.load_attention_seen())
                self.assertEqual(attention()[0]["since"], first)
                host["state"] = "HEALTHY"
                self.assertEqual(attention(), [])
                self.assertEqual(server.load_attention_seen(), {})
            host["state"] = "OFFLINE"
            with patch.object(server, "now", return_value=1_700_000_120.0):
                self.assertNotEqual(attention()[0]["since"], first)

    def test_attention_survives_cold_start_unknown(self):
        host = {"id": "hytetower", "name": "HYTETOWER", "state": "OFFLINE",
                "state_reason": "peer offline", "expected_online": True, "disks": []}
        def attention():
            return server.build_attention([host], [], {"sources": []}, {"state": "FRESH"},
                                          {"items": []}, {"instances": []}, {"backups": []}, {}, {})
        with tempfile.TemporaryDirectory(prefix="sc-attention-") as directory, \
             patch.object(server, "STATE_DIR", directory), \
             patch.object(server, "ATTENTION_FILE", os.path.join(directory, "attention-first-seen.json")), \
             patch.object(server, "FIRST_SEEN", {}):
            with patch.object(server, "now", return_value=1_700_000_000.0), \
                 patch.object(server, "probes_warmed", return_value=True):
                first = attention()[0]["since"]
            host["state"] = "UNKNOWN"
            with patch.object(server, "probes_warmed", return_value=False):
                self.assertEqual(attention()[0]["id"], "hostunk:hytetower")
                self.assertIn("host:hytetower", server.load_attention_seen())
            host["state"] = "OFFLINE"
            with patch.object(server, "now", return_value=1_700_000_120.0), \
                 patch.object(server, "probes_warmed", return_value=True):
                self.assertEqual(attention()[0]["since"], first)


if __name__ == "__main__":
    unittest.main()
