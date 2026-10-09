"""Exercise the live Edge evaluator with isolated snapshots and outbox."""

import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path


EVALUATOR = Path(__file__).with_name("evaluate.py")


class AlertPolicyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="edge-alert-test-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.status = self.root / "status.json"
        self.probes = self.root / "functional-probes.json"
        self.status.write_text(json.dumps({
            "core": {"tailscale_reachable": True, "ssh_reachable": True, "failed_services": 0},
            "edge": {"failed_services": 0, "root_disk_used_percent": 30},
            "backup": {"present": True, "complete": True, "age_minutes": 100, "repository_count": 2},
        }))
        self.probes.write_text(json.dumps({
            "core_ssh": {"ok": True}, "core_api": {"ok": True},
            "mqtt": {"tcp_reachable": True},
            "phaenon3": {"ok": True, "problems": []},
        }))

    def evaluate(self):
        env = {**os.environ,
               "CODEBLACK_STATUS_FILE": str(self.status),
               "CODEBLACK_PROBES_FILE": str(self.probes),
               "CODEBLACK_ALERT_DATA_DIR": str(self.root / "alerts"),
               "CODEBLACK_NOTIFICATION_OUTBOX": str(self.root / "outbox"),
               "CODEBLACK_DEBOUNCE_BAD": "1"}
        result = subprocess.run([sys.executable, str(EVALUATOR)], env=env,
                                capture_output=True, text=True, check=True)
        return json.loads(result.stdout)

    def test_high_vram_is_metric_not_incident(self):
        data = json.loads(self.probes.read_text())
        data["phaenon3"]["problems"] = ["vram_above_90_percent"]
        data["phaenon3"]["gpu"] = {"percent": 97.5}
        self.probes.write_text(json.dumps(data))
        result = self.evaluate()
        self.assertEqual(result["health"], "healthy")
        self.assertEqual(result["issues"], [])
        self.assertIsNone(result["event_emitted"])

    def test_actionable_gpu_and_queue_failures_remain_alerts(self):
        data = json.loads(self.probes.read_text())
        data["phaenon3"]["problems"] = [
            "vram_above_90_percent", "orphaned_llama_server_processes",
            "learning_queue_protection_blocked"]
        self.probes.write_text(json.dumps(data))
        issues = self.evaluate()["issues"]
        self.assertIn("phaenon3_orphaned_llama_server_processes", issues)
        self.assertIn("phaenon3_learning_queue_protection_blocked", issues)
        self.assertNotIn("phaenon3_vram_above_90_percent", issues)

    def test_stopped_collectors_cannot_look_healthy(self):
        old = time.time() - 240
        os.utime(self.status, (old, old))
        os.utime(self.probes, (old, old))
        issues = self.evaluate()["issues"]
        self.assertIn("edge_status_telemetry_stale", issues)
        self.assertIn("functional_probe_telemetry_stale", issues)


if __name__ == "__main__":
    unittest.main()
