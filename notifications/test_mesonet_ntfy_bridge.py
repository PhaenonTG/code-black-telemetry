import importlib.util
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

MODULE = Path(__file__).with_name("mesonet_ntfy_bridge.py")
spec = importlib.util.spec_from_file_location("mesonet_bridge", MODULE)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class MesonetBridgeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.db = root / "commands.sqlite"
        self.state = root / "state.json"
        self.health = root / "health.json"
        with closing(sqlite3.connect(self.db)) as connection:
            connection.execute("CREATE TABLE mesonet_alerts (id INTEGER PRIMARY KEY, role TEXT, kind TEXT, resolved INTEGER)")
            connection.execute("INSERT INTO mesonet_alerts VALUES (1, 'wind', 'offline', NULL)")
            connection.commit()
        for name, path in (("DB", self.db), ("STATE", self.state), ("HEALTH", self.health)):
            item = patch.object(bridge, name, path)
            item.start()
            self.addCleanup(item.stop)

    def test_baseline_then_new_alert_and_resolution(self):
        with patch.object(bridge, "publish") as send:
            self.assertEqual(bridge.main(), 0)
            send.assert_not_called()
            with closing(sqlite3.connect(self.db)) as connection:
                connection.execute("INSERT INTO mesonet_alerts VALUES (2, 'weather', 'update_failed', NULL)")
                connection.commit()
            self.assertEqual(bridge.main(), 0)
            self.assertEqual(send.call_count, 1)
            with closing(sqlite3.connect(self.db)) as connection:
                connection.execute("UPDATE mesonet_alerts SET resolved=123 WHERE id=2")
                connection.commit()
            self.assertEqual(bridge.main(), 0)
            self.assertEqual(send.call_count, 2)
            self.assertTrue(json.loads(self.health.read_text())["ok"])

    def test_publish_failure_is_retried(self):
        self.assertEqual(bridge.main(), 0)
        with closing(sqlite3.connect(self.db)) as connection:
            connection.execute("INSERT INTO mesonet_alerts VALUES (2, 'wind', 'reboot_loop', NULL)")
            connection.commit()
        with patch.object(bridge, "publish", side_effect=RuntimeError("unreachable")):
            self.assertEqual(bridge.main(), 1)
        self.assertFalse(json.loads(self.health.read_text())["ok"])
        with patch.object(bridge, "publish") as send:
            self.assertEqual(bridge.main(), 0)
            self.assertEqual(send.call_count, 1)

    def test_snooze_skips_transition_without_failing_bridge(self):
        self.assertEqual(bridge.main(), 0)
        with closing(sqlite3.connect(self.db)) as connection:
            connection.execute("INSERT INTO mesonet_alerts VALUES (3, 'wind', 'update_failed', NULL)")
            connection.commit()
        with patch.object(bridge, "snoozed", return_value=True), patch.object(bridge, "publish") as send:
            self.assertEqual(bridge.main(), 0)
            send.assert_not_called()
        self.assertEqual(json.loads(self.state.read_text())["seen"]["3"], "open")

    def test_offline_and_stale_are_status_only(self):
        self.assertEqual(bridge.main(), 0)
        with closing(sqlite3.connect(self.db)) as connection:
            connection.execute("INSERT INTO mesonet_alerts VALUES (3, 'wind', 'offline', NULL)")
            connection.execute("INSERT INTO mesonet_alerts VALUES (4, 'weather', 'stale', NULL)")
            connection.commit()
        with patch.object(bridge, "publish") as send:
            self.assertEqual(bridge.main(), 0)
            send.assert_not_called()
            with closing(sqlite3.connect(self.db)) as connection:
                connection.execute("UPDATE mesonet_alerts SET resolved=123 WHERE id IN (3,4)")
                connection.commit()
            self.assertEqual(bridge.main(), 0)
            send.assert_not_called()
        seen = json.loads(self.state.read_text())["seen"]
        self.assertEqual(seen["3"], "resolved")
        self.assertEqual(seen["4"], "resolved")
        self.assertEqual(json.loads(self.health.read_text())["active"], 0)


if __name__ == "__main__":
    unittest.main()
